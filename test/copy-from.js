'use strict'

const assert = require('assert')

const _ = require('lodash')
const pg = require('pg')

const copy = require('../').from

const client = function () {
  const client = new pg.Client()
  client.connect()
  return client
}

describe('copy-from', () => {
  it('test stream unpipe', (done) => {
    const fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')

    const stream = fromClient.query(copy('COPY numbers FROM STDIN'))
    let onEndCalled = false
    fromClient.connection.stream.on('unpipe', function (src) {
      assert.equal(src, stream)
      assert(!onEndCalled)
    })
    stream.on('end', function () {
      onEndCalled = true
      fromClient.end()
      done()
    })
    stream.end(Buffer.from('1\n'))
  })

  it('test construction', () => {
    const highWaterMark = 10
    const stream = copy('COPY numbers FROM STDIN', { highWaterMark: 10, objectMode: true })
    for (let i = 0; i < highWaterMark * 1.5; i++) {
      stream.write('1\t2\n')
    }
    assert(!stream.write('1\t2\n'), 'Should correctly set highWaterMark.')
  })

  it('test range', (done) => {
    const top = 1000
    const fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int, bigger_num int)')

    const txt = 'COPY numbers FROM STDIN'
    const stream = fromClient.query(copy(txt))
    for (let i = 0; i < top; i++) {
      stream.write(Buffer.from('' + i + '\t' + i * 10 + '\n'))
    }
    stream.end()
    stream.on('end', function () {
      fromClient.query('SELECT COUNT(*) FROM numbers', function (err, res) {
        assert.ifError(err)
        assert.equal(res.rows[0].count, top, 'expected ' + top + ' rows but got ' + res.rows[0].count)
        assert.equal(stream.rowCount, top, 'expected ' + top + ' rows but db count is ' + stream.rowCount)
        //console.log('found ', res.rows.length, 'rows')
        assert.equal(stream.rowCount, top, 'should have rowCount ' + top + ' ')
        fromClient.query('SELECT (max(num)) AS num FROM numbers', function (err, res) {
          assert.ifError(err)
          assert.equal(res.rows[0].num, top - 1)
          fromClient.end()
          done()
        })
      })
    })
  })

  it('test single end', (done) => {
    const fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    const stream = fromClient.query(copy(txt))
    let count = 0
    stream.on('end', function () {
      count++
      assert(count == 1, '`end` Event was triggered ' + count + ' times')
      if (count == 1) {
        fromClient.end()
        done()
      }
    })
    stream.end(Buffer.from('1\n'))
  })

  it('test client reuse', (done) => {
    const fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    let count = 0
    const countMax = 2
    const card = 100000
    const runStream = function () {
      const stream = fromClient.query(copy(txt))
      stream.on('end', function () {
        count++
        if (count < countMax) {
          runStream()
        } else {
          fromClient.query('SELECT sum(num) AS s FROM numbers', function (err, res) {
            const total = countMax * card * (card + 1)
            assert.equal(res.rows[0].s, total, 'copy-from.ClientReuse wrong total')
            fromClient.end()
            done()
          })
        }
      })
      stream.write(Buffer.from(_.range(0, card + 1).join('\n') + '\n'))
      stream.end(Buffer.from(_.range(0, card + 1).join('\n') + '\n'))
    }
    runStream()
  })
})
