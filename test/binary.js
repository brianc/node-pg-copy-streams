'use strict'

const assert = require('assert')

const async = require('async')
const _ = require('lodash')
const pg = require('pg')
const concat = require('concat-stream')
const { Transform, Writable } = require('stream')

const { from, to } = require('../')

describe('binary', () => {
  const getClient = function () {
    const client = new pg.Client()
    client.connect()
    return client
  }

  const LastFieldStream = function () {
    let firstChunk = true
    let byteaLength = 0
    const Streamer = new Transform({
      transform: function (chunk, enc, cb) {
        if (firstChunk) {
          // cf binary protocol description on https://www.postgresql.org/docs/10/sql-copy.html
          try {
            assert(chunk.length >= 25)
            assert.deepEqual(
              chunk.slice(0, 11),
              Buffer.from([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]),
              'COPY Signature should match'
            )
            assert.equal(chunk.readUInt32BE(11), 0, 'Flags should match')
            assert.equal(chunk.readUInt32BE(11 + 4), 0, 'Header Extension area length should match')
            assert.equal(chunk.readUInt16BE(15 + 4), 1, 'Number of fields in tuple should be 1')
          } catch (err) {
            return cb(err)
          }
          byteaLength = chunk.readUInt32BE(19 + 2)
          chunk = chunk.slice(21 + 4)
          firstChunk = false
        }
        if (byteaLength) {
          chunk = chunk.slice(0, byteaLength)
          byteaLength -= chunk.length
          this.push(chunk)
        }
        cb()
      },
    })
    return Streamer
  }

  it('low copy-to memory usage during large bytea streaming', (done) => {
    const power = 26
    const sql = "COPY (select (repeat('-', CAST(2^" + power + ' AS int)))::bytea) TO STDOUT BINARY'
    const client = getClient()

    const query = to(sql)
    const lfs = LastFieldStream()
    const noop = new Writable({
      write(chunk, enc, cb) {
        if (Math.random() < 0.02) {
          global.gc()
          const memNow = process.memoryUsage().external / 1024 / 1024
          try {
            const memLimit = 20 /*MB*/
            const memDiff = Math.abs(memNow - memStart)
            if (memDiff > memLimit) {
              global.gc()
            }
            assert(
              memDiff < memLimit,
              'copy of ' +
                Math.pow(2, power - 20) +
                'MB should need less than ' +
                memLimit +
                'MB of memoryUsage().external (' +
                Math.round(memDiff) +
                'MB observed)'
            )
          } catch (err) {
            cb(err)
          }
        }
        setImmediate(cb)
      },
    })

    global.gc(true)
    const memStart = process.memoryUsage().external / 1024 / 1024
    const stream = client.query(query).pipe(lfs).pipe(noop)

    stream.on('error', (err) => {
      client.end()
      done(err)
    })

    stream.on('finish', () => {
      client.end()
      done()
    })
  })

  it('extract bytea field', (done) => {
    const power = 25
    const sql = "COPY (select (repeat('-', CAST(2^" + power + ' AS int)))::bytea) TO STDOUT BINARY'
    const client = getClient()
    const copyToStream = client.query(to(sql))
    const assertResult = (buf) => {
      client.end()
      assert.deepEqual(buf, Buffer.alloc(Math.pow(2, power), '-'))
      done()
    }
    const ContentFilter = LastFieldStream()
    ContentFilter.on('error', (err) => {
      client.end()
      done(err)
    })

    copyToStream.pipe(ContentFilter).pipe(concat({ encoding: 'buffer' }, assertResult))
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
