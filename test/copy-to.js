'use strict'

const assert = require('assert')

const _ = require('lodash')
const concat = require('concat-stream')
const Writable = require('stream').Writable
const pg = require('pg')
const PassThrough = require('stream').PassThrough
const Transform = require('stream').Transform

const csvParser = require('csv-parser')
const csvParse = require('csv-parse')

const copy = require('../').to
const code = require('../message-formats')

describe('copy-to', () => {
  describe('integration tests (postgres)', () => {
    function getClient() {
      const client = new pg.Client()
      client.connect()
      return client
    }

    function executeSql(sql) {
      const client = getClient()
      client.query(sql, () => {
        client.end()
      })
    }

    function assertCopyToResult(sql, assertFn) {
      const client = getClient()
      const chunks = []
      let hasCompleted = false

      function complete(err, chunks, result, stream) {
        // both 'error' and 'end' events may fire, guard so assertFn is called only once
        if (!hasCompleted) {
          hasCompleted = true
          client.end()
          assertFn(err, chunks, result, stream)
        }
      }

      const copyToStream = client.query(copy(sql))

      copyToStream.on('error', complete)
      copyToStream.on('end', () => {
        const result = Buffer.concat(chunks).toString()
        complete(null, chunks, result, copyToStream)
      })
      copyToStream.pipe(
        new Transform({
          transform: (chunk, enc, cb) => {
            chunks.push(chunk)
            cb()
          },
        })
      )
    }

    it('provides row count', (done) => {
      const top = 100
      const sql = 'COPY (SELECT * from generate_series(0, ' + (top - 1) + ')) TO STDOUT'
      assertCopyToResult(sql, (err, chunks, result, stream) => {
        assert.ifError(err)
        assert.equal(stream.rowCount, top, 'should have rowCount ' + top + ' but got ' + stream.rowCount)
        done()
      })
    })

    it('internal postgres error ends copy and emits error', (done) => {
      assertCopyToResult('COPY (SELECT pg_sleep(10)) TO STDOUT', (err, chunks, result, stream) => {
        assert.notEqual(err, null)
        const expectedMessage = 'canceling statement due to user request'
        assert.notEqual(
          err.toString().indexOf(expectedMessage),
          -1,
          'Error message should mention reason for query failure.'
        )
        done()
      })

      setTimeout(() => {
        executeSql(
          "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query ~ 'pg_sleep' AND NOT query ~ 'pg_cancel_backend'"
        )
      }, 20)
    })

    it('interspersed NoticeResponse message is ignored', (done) => {
      // on the copy stream.
      const client = getClient()
      let set = ''
      set += 'SET SESSION client_min_messages = WARNING;'
      set += 'SET SESSION standard_conforming_strings = off;'
      set += 'SET SESSION escape_string_warning = on;'
      client.query(set, function (err, res) {
        assert.equal(err, null, 'testNoticeResponse - could not SET parameters')
        const runStream = function (callback) {
          const sql = "COPY (SELECT '\\\n') TO STDOUT"
          const stream = client.query(copy(sql))
          stream.on('error', callback)

          // make sure stream is pulled from
          stream.pipe(concat(callback.bind(null, null)))
        }

        runStream(function (err) {
          assert.ifError(err)
          client.end()
          done()
        })
      })
    })

    it('client can be reused for another COPY TO query', (done) => {
      const client = getClient()
      const generateRows = 100
      const totalRuns = 5
      let runsLeftToStart = totalRuns
      let currentRunNumber = 0

      function runStream(num, callback) {
        const sql = 'COPY (SELECT * FROM generate_series(0,' + generateRows + ')) TO STDOUT'
        const stream = client.query(copy(sql))
        stream.on('error', callback)
        stream.pipe(
          concat(function (buf) {
            const res = buf.toString('utf8')
            const exp = _.range(0, generateRows + 1).join('\n') + '\n'
            assert.equal(res, exp, 'clientReuse: sent & received buffer should be equal')
            currentRunNumber++
            callback()
          })
        )
      }

      function processResult(err) {
        assert.ifError(err)
        runsLeftToStart--
        if (runsLeftToStart) {
          runStream(currentRunNumber, processResult)
        } else {
          assert.equal(
            currentRunNumber,
            totalRuns,
            'clientReuse: there should be equal amount of queries on the same client'
          )
          client.end()
          done()
        }
      }

      runStream(currentRunNumber, processResult)
    })

    it('client can be reused for another query', (done) => {
      const client = getClient()

      // uncomment the code to see pausing and resuming of the connection stream

      //const orig_resume = client.connection.stream.resume;
      //const orig_pause = client.connection.stream.pause;
      //
      //client.connection.stream.resume = function () {
      //  console.log('resume', new Error().stack);
      //  orig_resume.apply(this, arguments)
      //}
      //
      //client.connection.stream.pause = function () {
      //  console.log('pause', new Error().stack);
      //  orig_pause.apply(this, arguments)
      //}

      function testConnection() {
        client.query('SELECT 1', function () {
          client.end()
          done()
        })
      }

      const writable = new Writable({
        write: function (chunk, encoding, cb) {
          cb()
        },
      })
      writable.on('finish', () => {
        setTimeout(testConnection, 30) // test if the connection didn't drop flowing state
      })

      const sql = 'COPY (SELECT 1) TO STDOUT'
      const stream = client.query(copy(sql, { highWaterMark: 1 }))
      stream.pipe(writable)
    })

    it('two small rows are combined into single chunk', (done) => {
      const sql = 'COPY (SELECT * FROM generate_series(1, 2)) TO STDOUT'
      assertCopyToResult(sql, (err, chunks, result, stream) => {
        assert.ifError(err)
        assert.equal(chunks.length, 1)
        assert.deepEqual(chunks[0], Buffer.from('1\n2\n'))
        done()
      })
    })

    it('one large row emits multiple chunks', (done) => {
      const fieldSize = 64 * 1024
      const sql = `COPY (SELECT repeat('-', ${fieldSize})) TO STDOUT`
      assertCopyToResult(sql, (err, chunks, result, stream) => {
        assert.ifError(err)
        assert(chunks.length > 1)
        assert.equal(result, `${'-'.repeat(fieldSize)}\n`)
        done()
      })
    })
  })

  describe('integration tests (csv parsers)', () => {
    function readParserResult(csvModule, csvModuleOpts, inputByteArrays) {
      return new Promise((resolve, reject) => {
        const parser = csvModule(csvModuleOpts)
        parser.on('error', reject)
        parser.pipe(concat({ encoding: 'object' }, resolve))

        for (const inputByteArray of inputByteArrays) {
          const inputBuffer = Buffer.from(inputByteArray)
          parser.write(inputBuffer)
        }
        parser.end()
      })
    }

    async function assertResult(csvModule, csvModuleOpts, inputByteArrays, expectedContent) {
      const actualContent = await readParserResult(csvModule, csvModuleOpts, inputByteArrays)
      assert.deepEqual(actualContent, expectedContent)
    }

    it('module csv-parser handles cross boundary lines', async () => {
      const input = Buffer.from('hello,world\ncrossing,boundaries')

      for (let splitAt = 1; splitAt < input.length; splitAt++) {
        const inputPart1 = input.slice(0, splitAt)
        const inputPart2 = input.slice(splitAt)

        assert(inputPart1.length > 0)
        assert(inputPart2.length > 0)

        await assertResult(
          csvParser,
          { headers: false },
          [inputPart1, inputPart2],
          [
            { '0': 'hello', '1': 'world' },
            { '0': 'crossing', '1': 'boundaries' },
          ]
        )
      }
    })

    it('module csv-parse handles cross boundary lines', async () => {
      const input = Buffer.from('hello,world\ncrossing,boundaries')

      for (let splitAt = 1; splitAt < input.length; splitAt++) {
        const inputPart1 = input.slice(0, splitAt)
        const inputPart2 = input.slice(splitAt)

        assert(inputPart1.length > 0)
        assert(inputPart2.length > 0)

        await assertResult(
          csvParse,
          {},
          [inputPart1, inputPart2],
          [
            ['hello', 'world'],
            ['crossing', 'boundaries'],
          ]
        )
      }
    })
  })

  describe('unit tests', () => {
    function readCopyToResult(inputByteArrays) {
      return new Promise((resolve, reject) => {
        // mock a pg client/server
        const pgStream = new PassThrough()
        const pgConnection = {
          stream: pgStream,
          query: () => {},
          removeAllListeners: () => {},
        }
        const pgClient = {
          connection: pgConnection,
          query: function (submittable) {
            submittable.submit(this.connection)
          },
        }

        const copyToStream = copy(/*sql*/)
        pgClient.query(copyToStream)

        for (const inputByteArray of inputByteArrays) {
          const inputBuffer = Buffer.from(inputByteArray)
          pgStream.write(inputBuffer)
        }

        copyToStream.on('error', reject)
        copyToStream.pipe(concat({ encoding: 'string' }, resolve))
      })
    }

    async function assertResult(inputByteArrays, expectedContent) {
      const actualContent = await readCopyToResult(inputByteArrays)
      assert.deepEqual(actualContent, expectedContent)
    }

    it('forwards passed options to parent Transform stream', () => {
      const sql = 'COPY (SELECT * FROM generate_series(0, 10)) TO STDOUT'
      const stream = copy(sql, { highWaterMark: 10 })
      assert.equal(stream._readableState.highWaterMark, 10, 'Client should have been set with a correct highWaterMark.')
    })

    it('input without row data gives empty result', async () => {
      await assertResult([[code.CopyOutResponse, 0x0, 0x0, 0x0, 0x4, code.CopyDone, 0x0, 0x0, 0x0, 0x4]], '')
    })

    it('complex input cut at chunk boundary every possible way gives correct result', async () => {
      const input = []
      input.push(code.CopyOutResponse, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x01, 0x00, 0x00)
      input.push(code.CopyData, 0x00, 0x00, 0x00, 0x07, 0x78, 0x79, 0x0a)
      input.push(code.CopyDone, 0x00, 0x00, 0x00, 0x04)
      input.push(code.CommandComplete, 0x00, 0x00, 0x00, 0x0b, 0x43, 0x4f, 0x50, 0x59, 0x20, 0x31, 0x00)
      input.push(code.ReadyForQuery, 0x00, 0x00, 0x00, 0x05, 0x4)

      for (let splitAt = 1; splitAt < input.length; splitAt++) {
        const inputPart1 = input.slice(0, splitAt)
        const inputPart2 = input.slice(splitAt)

        assert(inputPart1.length > 0)
        assert(inputPart2.length > 0)

        await assertResult([inputPart1, inputPart2], 'xy\n')
      }
    })
  })
})
