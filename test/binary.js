'use strict'

const assert = require('assert')

const async = require('async')
const _ = require('lodash')
const pg = require('pg')
const concat = require('concat-stream')
const { Transform } = require('stream')

const { from, to } = require('../')

describe('binary', () => {
  const getClient = function () {
    const client = new pg.Client()
    client.connect()
    return client
  }

  it('extract bytea field', (done) => {
    const power = 17
    const sql = "COPY (select (repeat('-', CAST(2^" + power + ' AS int)))::bytea) TO STDOUT BINARY'
    const client = getClient()
    const copyToStream = client.query(to(sql))
    const assertResult = (buf) => {
      client.end()
      assert.deepEqual(buf, Buffer.alloc(Math.pow(2, power), '-'))
      done()
    }
    let firstChunk = true
    let byteaLength = 0
    copyToStream
      .pipe(
        new Transform({
          transform: function (chunk, enc, cb) {
            if (firstChunk) {
              const headerLength = /*Signature*/ 11 + /*Flags*/ 4 + /*Extension*/ 4 + /*FieldCount*/ 2
              byteaLength = chunk.readUInt32BE(headerLength)
              chunk = chunk.slice(headerLength + 4)
              firstChunk = false
            }
            chunk = chunk.slice(0, byteaLength)
            byteaLength -= chunk.length
            this.push(chunk)
            cb()
          },
        })
      )
      .pipe(concat({ encoding: 'buffer' }, assertResult))
  })

  it('table-2-table binary copy should work', (done) => {
    const fromClient = getClient()
    const toClient = getClient()

    let queries = [
      'DROP TABLE IF EXISTS data',
      'CREATE TABLE IF NOT EXISTS data (num BIGINT, word TEXT)',
      "INSERT INTO data (num, word) VALUES (1, 'hello'), (2, 'other thing'), (3, 'goodbye')",
      'DROP TABLE IF EXISTS data_copy',
      'CREATE TABLE IF NOT EXISTS data_copy (LIKE data INCLUDING ALL)',
    ]

    async.eachSeries(queries, _.bind(fromClient.query, fromClient), function (err) {
      assert.ifError(err)

      const fromStream = fromClient.query(to('COPY (SELECT * FROM data) TO STDOUT BINARY'))
      const toStream = toClient.query(from('COPY data_copy FROM STDIN BINARY'))

      const runStream = function (callback) {
        fromStream.on('error', callback)
        toStream.on('error', callback)
        toStream.on('finish', callback)
        fromStream.pipe(toStream)
      }
      runStream(function (err) {
        assert.ifError(err)

        toClient.query('SELECT * FROM data_copy ORDER BY num', function (err, res) {
          assert.equal(res.rowCount, 3, 'expected 3 rows but got ' + res.rowCount)
          assert.equal(res.rows[0].num, 1)
          assert.equal(res.rows[0].word, 'hello')
          assert.equal(res.rows[1].num, 2)
          assert.equal(res.rows[1].word, 'other thing')
          assert.equal(res.rows[2].num, 3)
          assert.equal(res.rows[2].word, 'goodbye')
          queries = ['DROP TABLE data', 'DROP TABLE data_copy']
          async.each(queries, _.bind(fromClient.query, fromClient), function (err) {
            assert.ifError(err)
            fromClient.end()
            toClient.end()
            done()
          })
        })
      })
    })
  })
})
