'use strict'

const pg = require('pg')
const async = require('async')

describe('copy-both', () => {
  describe('integration tests (postgres)', () => {
    function getClient(cb) {
      const client = new pg.Client({
        replication: 'database',
      })
      client.connect(cb)
      return client
    }

    it('env should accept replication mode', (done) => {
      const client = getClient((err) => {
        if (err) return done(err)
        const sql = [`CREATE_REPLICATION_SLOT slotplug LOGICAL test_decoding`, `DROP_REPLICATION_SLOT slotplug`]

        async.eachSeries(sql, client.query.bind(client), function (err) {
          client.end()
          done(err)
        })
      })
    })
  })
})
