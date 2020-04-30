'use strict'

var assert = require('assert')

var concat = require('concat-stream')
var _ = require('lodash')
var pg = require('pg')

var copy = require('../').from

var client = function () {
  var client = new pg.Client()
  client.connect()
  return client
}

describe('copy-from', () => {
  it('test stream unpipe', (done) => {
    var fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')

    var stream = fromClient.query(copy('COPY numbers FROM STDIN'))
    var onEndCalled = false
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
    var highWaterMark = 10
    var stream = copy('COPY numbers FROM STDIN', { highWaterMark: 10, objectMode: true })
    for (var i = 0; i < highWaterMark * 1.5; i++) {
      stream.write('1\t2\n')
    }
    assert(!stream.write('1\t2\n'), 'Should correctly set highWaterMark.')
  })

  it('test range', (done) => {
    var top = 1000
    var fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int, bigger_num int)')

    var txt = 'COPY numbers FROM STDIN'
    var stream = fromClient.query(copy(txt))
    for (var i = 0; i < top; i++) {
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
    var fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    var txt = 'COPY numbers FROM STDIN'
    var stream = fromClient.query(copy(txt))
    var count = 0
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
    var fromClient = client()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    var txt = 'COPY numbers FROM STDIN'
    var count = 0
    var countMax = 2
    var card = 100000
    var runStream = function () {
      var stream = fromClient.query(copy(txt))
      stream.on('end', function () {
        count++
        if (count < countMax) {
          runStream()
        } else {
          fromClient.query('SELECT sum(num) AS s FROM numbers', function (err, res) {
            var total = countMax * card * (card + 1)
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
