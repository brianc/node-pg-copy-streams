'use strict'

const assert = require('assert')

const _ = require('lodash')
const pg = require('pg')
const { finished, pipeline, PassThrough } = require('stream')
const { promisify } = require('util')
const { spawn } = require('child_process')

const copy = require('../').from

describe('copy-from', () => {
  function getClient(config) {
    const client = new pg.Client(config)
    client.connect()
    return client
  }

  function createCopyFromQuery(table, fields, callback) {
    const client = getClient()
    client.query(`CREATE TEMP TABLE ${table}${fields}`, () => {
      let sql = `COPY ${table} FROM STDIN`
      if (table === 'syntaxError') {
        sql = `COPY (SELECT INVALID SYNTAX) FROM STDIN`
      }
      const copyFromStream = client.query(copy(sql))
      callback(client, copyFromStream)
    })
  }

  function spyOnEmitCalls(stream) {
    stream.emits = {}
    const realEmit = stream.emit
    stream.emit = function () {
      const [eventName, ...args] = arguments
      if (!stream.emits[eventName]) {
        stream.emits[eventName] = []
      }
      stream.emits[eventName].push(args)
      realEmit.apply(this, arguments)
    }
  }

  function processCopyFromStreamForAssertFn(table, chunks, client, copyFromStream, assertFn) {
    spyOnEmitCalls(copyFromStream)
    function complete(err, rows, stream) {
      client.end()
      assertFn(err, rows, stream)
    }
    copyFromStream.on('error', (err) => {
      complete(err, null, copyFromStream)
    })
    copyFromStream.on('finish', () => {
      client.query({ text: `SELECT * FROM ${table}`, rowMode: 'array' }, (err, res) => {
        complete(err, res.rows, copyFromStream)
      })
    })
    for (const chunk of chunks) {
      copyFromStream.write(chunk)
    }
    copyFromStream.end()
  }

  function assertCopyFromResult(table, fields, chunks, assertFn) {
    createCopyFromQuery(table, fields, (client, copyFromStream) => {
      processCopyFromStreamForAssertFn(table, chunks, client, copyFromStream, assertFn)
    })
  }

  it('correctly handles simple case', (done) => {
    assertCopyFromResult('numbers', '(num int)', [Buffer.from('1\n')], (err, rows, stream) => {
      assert.deepEqual(rows, [[1]])
      done(err)
    })
  })

  it('detect error when field mismatch', (done) => {
    assertCopyFromResult('numbers', '(num int)', [Buffer.from('1,2\n')], (err, rows, stream) => {
      assert.notEqual(err, null)
      const expectedMessage = /invalid input syntax for (type )?integer/
      // assert.match(
      //   err.toString(),
      //   expectedMessage,
      //   'Error message should mention reason for query failure.'
      // )
      assert.notEqual(
        err.toString().search(expectedMessage),
        -1,
        'Error message should mention reason for query failure.'
      )
      done()
    })
  })

  it('should respect highWaterMark backpressure', () => {
    const highWaterMark = 10
    const stream = copy('COPY numbers FROM STDIN', { highWaterMark: 10, objectMode: true })
    for (let i = 0; i < highWaterMark * 1.5; i++) {
      stream.write('1\t2\n')
    }
    assert(!stream.write('1\t2\n'), 'Should correctly set highWaterMark.')
  })

  it('correctly handle more heavy scenario', (done) => {
    const top = 130000
    const chunks = []
    const expected = []
    for (let i = 0; i < top; i++) {
      chunks.push(Buffer.from('' + i + '\t' + i * 10 + '\n'))
      expected.push([i, i * 10])
    }

    assertCopyFromResult('numbers', '(num1 int, num2 int)', chunks, (err, rows, stream) => {
      assert.deepStrictEqual(rows, expected, 'not matched')
      assert.equal(stream.rowCount, top, 'should have rowCount ' + top + ' ')
      done()
    })
  }).timeout(120000)

  it('test client reuse', (done) => {
    const fromClient = getClient()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    let count = 0
    const countMax = 2
    const card = 100000
    const runStream = function () {
      const stream = fromClient.query(copy(txt))
      stream.on('finish', function () {
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

  it('test empty source - issue #112', (done) => {
    const fromClient = getClient()
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    const query = copy(txt)
    query.on('finish', function () {
      fromClient.end()
      done()
    })
    fromClient.query(query)
    query.end()
  })

  it('`pg` query_timeout should be properly canceled upon error - issue #125', (done) => {
    const fromClient = getClient({ query_timeout: 500 })
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    const query = copy(txt)
    query.on('error', function (err) {
      fromClient.end()
      done()
    })
    fromClient.query(query)
    query.write('A')
    query.end()
  })

  it('`pg` query_timeout should be properly canceled upon success - issue #125', (done) => {
    const fromClient = getClient({ query_timeout: 1000 })
    fromClient.query('CREATE TEMP TABLE numbers(num int)')
    const txt = 'COPY numbers FROM STDIN'
    const query = copy(txt)
    query.on('finish', function (err) {
      fromClient.end()
      done()
    })
    fromClient.query(query)
    query.write('1')
    query.end()
  })

  describe('stream compliance', () => {
    describe('successful stream', () => {
      it("emits 1 'finish' (writable stream)", (done) => {
        assertCopyFromResult('tablename', '(field1 int)', [Buffer.from('1\n')], (err, rows, stream) => {
          assert.ifError(err)
          assert.equal(stream.emits['finish'].length, 1)
          done()
        })
      })

      it("emits 0 'end' (writable stream)", (done) => {
        assertCopyFromResult('tablename', '(field1 int)', [Buffer.from('1\n')], (err, rows, stream) => {
          assert.ifError(err)
          assert.equal(stream.emits['end'], undefined)
          done()
        })
      })

      it('works with finished()', (done) => {
        if (!finished) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          finished(copyFromStream, (err) => {
            assert.ifError(err)
            client.end()
            done()
          })
          copyFromStream.end(Buffer.from('1\n'))
        })
      })

      it('works with pipeline()', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          const pt = new PassThrough()
          pipeline(pt, copyFromStream, (err) => {
            assert.ifError(err)
            client.end()
            done()
          })
          pt.end(Buffer.from('1\n'))
        })
      })
    })

    it('works with await pipeline()', async () => {
      if (!pipeline) return
      const client = new pg.Client()
      await client.connect()
      await client.query('CREATE TEMP TABLE numbers (num1 int)')
      try {
        const total = 1000
        const seq = spawn('seq', [1, total]).stdout
        const copyFromStream = client.query(copy(`COPY numbers FROM STDIN`))
        await promisify(pipeline)(seq, copyFromStream)
        const res = await client.query('SELECT count(*) FROM numbers')
        assert.equal(res.rows[0].count, total)
      } finally {
        await client.end()
      }
    })

    describe('erroneous stream (syntax error)', () => {
      it("emits 0 'finish'", (done) => {
        assertCopyFromResult('syntaxError', '(field1 int)', [Buffer.from('1\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['finish'], undefined)
          done()
        })
      })

      it("emits 0 'end'", (done) => {
        assertCopyFromResult('syntaxError', '(field1 int)', [Buffer.from('1\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['end'], undefined)
          done()
        })
      })

      it("emits 1 'error'", (done) => {
        assertCopyFromResult('syntaxError', '(field1 int)', [Buffer.from('1\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['error'].length, 1)
          done()
        })
      })

      it('works with finished()', (done) => {
        if (!finished) return done()
        createCopyFromQuery('syntaxError', '(field1 int)', (client, copyFromStream) => {
          finished(copyFromStream, (err) => {
            assert.ok(err)
            client.end()
            done()
          })
          copyFromStream.end(Buffer.from('1\n'))
        })
      })

      it('works with pipeline()', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('syntaxError', '(field1 int)', (client, copyFromStream) => {
          const pt = new PassThrough()
          pipeline(pt, copyFromStream, (err) => {
            assert.ok(err)
            client.end()
            done()
          })
          pt.end(Buffer.from('1\n'))
        })
      })
    })

    describe('erroneous stream (internal error)', () => {
      it("emits 0 'finish'", (done) => {
        assertCopyFromResult('tablename', '(field1 int)', [Buffer.from('1,2\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['finish'], undefined)
          done()
        })
      })

      it("emits 0 'end'", (done) => {
        assertCopyFromResult('tablename', '(field1 int)', [Buffer.from('1,2\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['end'], undefined)
          done()
        })
      })

      it("emits 1 'error'", (done) => {
        assertCopyFromResult('tablename', '(field1 int)', [Buffer.from('1,2\n')], (err, rows, stream) => {
          assert.ok(err)
          assert.equal(stream.emits['error'].length, 1)
          done()
        })
      })

      it('works with finished()', (done) => {
        if (!finished) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          finished(copyFromStream, (err) => {
            assert.ok(err)
            client.end()
            done()
          })
          copyFromStream.end(Buffer.from('1,2\n'))
        })
      })

      it('works with pipeline()', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          const pt = new PassThrough()
          pipeline(pt, copyFromStream, (err) => {
            assert.ok(err)
            client.end()
            done()
          })
          pt.end(Buffer.from('1,2\n'))
        })
      })
    })

    describe('using destroy() should send copyFail', () => {
      it('works when destroy() is called via pipeline() before copyInResponse has been received', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          spyOnEmitCalls(copyFromStream)
          const pt = new PassThrough()
          copyFromStream.on('error', (err) => {
            assert.equal(copyFromStream.emits['error'].length, 1)
            const expectedMessage = /COPY from stdin failed/
            assert.notEqual(
              copyFromStream.emits['error'][0].toString().search(expectedMessage),
              -1,
              'Error message should mention that COPY failed'
            )
            client.end()
            done()
          })
          pipeline(pt, copyFromStream, (err) => {
            assert.ok(err)
          })
          pt.emit('error', new Error('pipelineError'))
        })
      })
      it('works when destroy() is called via pipeline() after copyInResponse has been received', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          spyOnEmitCalls(copyFromStream)
          const pt = new PassThrough()
          copyFromStream.on('error', (err) => {
            assert.equal(copyFromStream.emits['error'].length, 1)
            const expectedMessage = /COPY from stdin failed/
            assert.notEqual(
              copyFromStream.emits['error'][0].toString().search(expectedMessage),
              -1,
              'Error message should mention that COPY failed'
            )
            client.end()
            done()
          })
          pipeline(pt, copyFromStream, (err) => {
            assert.ok(err)
          })
          client.connection.once('copyInResponse', () => {
            pt.emit('error', new Error('pipelineError'))
          })
        })
      })
      it('works when destroy() is called before copyInResponse has been received', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          spyOnEmitCalls(copyFromStream)
          copyFromStream.on('error', (err) => {
            assert.equal(copyFromStream.emits['error'].length, 1)
            const expectedMessage = /COPY from stdin failed/
            assert.notEqual(
              copyFromStream.emits['error'][0].toString().search(expectedMessage),
              -1,
              'Error message should mention that COPY failed'
            )
            assert.ok(err)
            client.end()
            done()
          })
          copyFromStream.destroy(new Error('myError'))
        })
      })
      it('works when destroy() is called after copyInResponse has been received', (done) => {
        if (!pipeline) return done()
        createCopyFromQuery('tablename', '(field1 int)', (client, copyFromStream) => {
          spyOnEmitCalls(copyFromStream)
          copyFromStream.on('error', (err) => {
            assert.equal(copyFromStream.emits['error'].length, 1)
            const expectedMessage = /COPY from stdin failed/
            assert.notEqual(
              copyFromStream.emits['error'][0].toString().search(expectedMessage),
              -1,
              'Error message should mention that COPY failed'
            )
            assert.ok(err)
            client.end()
            done()
          })
          client.connection.once('copyInResponse', () => {
            copyFromStream.destroy(new Error('myError'))
          })
        })
      })
    })
  })
})
