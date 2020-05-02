const Benchmark = require('benchmark')
const cp = require('duplex-child-process')
const pg = require('pg')

const copy = require('../').to

const client = function () {
  const client = new pg.Client()
  client.connect()
  return client
}

const psql = '/opt/postgresql-9.6.1/bin/psql'
const suite = new Benchmark.Suite()
suite
  .add({
    name: 'psql COPY out of postgres',
    defer: true,
    fn: function (d) {
      const from = cp.spawn(psql, ['postgres', '-c', 'COPY plug TO STDOUT'])
      from.resume()
      from.on('close', function () {
        d.resolve()
      })
    },
  })
  .add({
    name: 'pg-copy-stream COPY out of postgres',
    defer: true,
    fn: function (d) {
      const c = client()
      const copyOut = c.query(copy('COPY plug TO STDOUT'))
      copyOut.resume()
      copyOut.on('end', function () {
        c.end()
        d.resolve()
      })
    },
  })
  .on('cycle', function (event) {
    console.log(String(event.target))
  })
  .on('complete', function () {
    console.log('Fastest is ' + this.filter('fastest').map('name'))
  })

const c = client()
c.query('DROP TABLE IF EXISTS plug', function () {
  c.query('CREATE TABLE plug (field text)', function () {
    c.query("INSERT INTO plug(field) SELECT (repeat('-', CAST(2^17 AS int))) FROM generate_series(1, 10)", function () {
      c.end()
      suite.run()
    })
  })
})
