'use strict'

const assert = require('assert')
const pg = require('pg')
const async = require('async')
const copyBoth = require('../copy-both.js')
const { Transform, pipeline, finished } = require('stream')
const BufferList = require('obuf')

before(async () => {
  const client = new pg.Client()
  await client.connect()
  await client.query(`CREATE TABLE IF NOT EXISTS plug (col1 text)`)
  client.end()
})

after(async () => {
  // avoid leaving a dangling replication slot on the test database
  // that could cause wal inflation if unattended

  let client = new pg.Client({ replication: 'database' })
  await client.connect()
  try {
    await client.query(`DROP_REPLICATION_SLOT slotplug`)
  } catch (err) {
    console.log(err)
  }
  await client.end()

  client = new pg.Client()
  await client.connect()
  await client.query(`DROP TABLE IF EXISTS plug`)
  client.end()
})

describe('copy-both', () => {
  describe('integration tests (postgres)', () => {
    function getClient(opts, cb) {
      const client = new pg.Client(opts)
      client.connect(cb)
      return client
    }

    function getCopyDataHandlerStream(hook) {
      const buf = new BufferList()
      const PG_CODE = 1
      const PG_MESSAGE = 2
      let state = PG_CODE
      let code = null

      const parser = new Transform({
        transform(chunk, encoding, callback) {
          buf.push(chunk)
          while (buf.size > 0) {
            if (state === PG_CODE) {
              if (!buf.has(1)) break
              code = buf.readUInt8()
              state = PG_MESSAGE
            }
            if (state === PG_MESSAGE) {
              if (code === 0x6b /*k*/) {
                buf.take(8 + 8 + 1)
                state = PG_CODE
              } else if (code === 0x77 /*w*/) {
                buf.take(8 + 8 + 8)
                buf.take(buf.size) /* plugin data */
                state = PG_CODE
                this.XLogDataCount++
              } else {
                return callback(new Error('wrong message code inside'))
              }
            }
            break
          }
          hook && hook.call(this)
          callback()
        },
        flush() {},
      })
      parser.XLogDataCount = 0
      return parser
    }

    it('check testing wal_level configuration in postgresql.conf', async () => {
      const client = new pg.Client()
      await client.connect()
      const key = 'wal_level'
      const value = (await client.query(`SHOW ${key}`)).rows[0][key]
      await client.end()
      assert.equal(
        value,
        'logical',
        `you must set ${key} = logical in postgresql.conf (+restart) to test replication features, found ${key} = ${value}`
      )
    })

    it('check testing max_wal_senders configuration in postgresql.conf', async () => {
      const client = new pg.Client()
      await client.connect()
      const key = 'max_wal_senders'
      const value = (await client.query(`SHOW ${key}`)).rows[0][key]
      await client.end()
      assert.ok(value > 0, `you must set ${key} in postgresql.conf (+restart) to a value > 0, ${value} found`)
    })

    it('check testing max_replication_slots configuration in postgresql.conf', async () => {
      const client = new pg.Client()
      await client.connect()
      const key = 'max_replication_slots'
      const value = (await client.query(`SHOW ${key}`)).rows[0][key]
      await client.end()
      assert.ok(value > 0, `you must set ${key} in postgresql.conf (+restart) to a value > 0, ${value} found`)
    })

    /*
    it('check testing wal_sender_timeout configuration in postgresql.conf', async () => {
      const client = new pg.Client()
      await client.connect()
      const key = 'wal_sender_timeout'
      const expected = 1000
      const value = (await client.query(`SELECT setting::int FROM pg_catalog.pg_settings WHERE name = '${key}'`)).rows[0]['setting']
      await client.end()
      assert.equal(value, expected, `you must set ${key} = ${expected} in postgresql.conf (+restart) to test replication features, found ${key} = ${value}`)
    })

    it('should properly handle terminating walsender process due to replication timeout', (done) => {
      const client = new pg.Client({ replication: 'database' })
      client.connect((err) => {
        if (err) return done(err)
        client.on('error', ()=>{})
        const sql = [`CREATE_REPLICATION_SLOT slotplug LOGICAL test_decoding`]
        async.eachSeries(sql, client.query.bind(client), function (err) {
          if (err) {
            client.end()
            return done(err)
          }
          const copyBothStream = copyBoth(`START_REPLICATION SLOT slotplug LOGICAL 0/0`, { alignOnCopyDataFrame: true })
          client.query(copyBothStream)
          pipeline(copyBothStream, getCopyDataHandlerStream(), (err)=>{})
          finished(copyBothStream, (err) => {
            try {
              assert.equal(err.toString(), 'Error: Connection terminated unexpectedly')
            }catch(err) {
              return done(err)
            }
            done()
          })
        })
      })
    }).timeout(5000)
*/
    it('should receive messages on the copyOut channel', (done) => {
      if (!pipeline) return done() /* do not test under node 8 */
      if (!finished) return done() /* do not test under node 8 */

      const client = getClient({ replication: 'database' }, (err) => {
        if (err) return done(err)

        client.on('error', () => {})
        const sql = [`CREATE_REPLICATION_SLOT slotplug LOGICAL test_decoding`]

        async.eachSeries(sql, client.query.bind(client), function (err) {
          if (err) {
            client.end()
            return done(err)
          }
          const copyBothStream = copyBoth(`START_REPLICATION SLOT slotplug LOGICAL 0/0`, { alignOnCopyDataFrame: true })
          client.query(copyBothStream)
          const copyDataHandler = getCopyDataHandlerStream(function () {
            if (this.XLogDataCount >= 3) {
              // close the replication
              // this can be slow as per https://commitfest.postgresql.org/11/621/
              copyBothStream.end()
            }
          })
          pipeline(copyBothStream, copyDataHandler, (err) => {})
          finished(copyBothStream, (err) => {
            client.end()
            done(err)
          })
          const fieldSize = 64 * 1024

          const c2 = getClient({}, (err) => {
            const sql = [`INSERT INTO plug (col1) values (repeat('-', ${fieldSize}))`]
            async.eachSeries(sql, c2.query.bind(c2), function (err) {
              if (err) return done(err)
              c2.end()
            })
          })
        })
      })
    }).timeout(60000)
  })
})
