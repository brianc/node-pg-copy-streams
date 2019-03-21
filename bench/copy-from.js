var Benchmark = require('benchmark');
var cp = require('duplex-child-process');
var pg = require('pg')

var copy = require('../').from

var client = function() {
  var client = new pg.Client()
  client.connect()
  return client
}

var psql = '/opt/postgresql-9.6.1/bin/psql'
var limit = 999999;
var inStream = function() {
  return cp.spawn('seq', ['0', ''+limit]);
}
var suite = new Benchmark.Suite;
suite
.add({
  name: 'unix pipe into psql COPY',
  defer: true,
  fn: function(d) {
    var c = client();
    c.query('DROP TABLE IF EXISTS plugnumber', function() {
      c.query('CREATE TABLE plugnumber (num int)', function() {
        c.end();
        var from = cp.spawn('sh', ['-c', 'seq 0 '+limit+' | '+psql+' postgres -c \'COPY plugnumber FROM STDIN\''])
        from.on('close', function() {
          d.resolve();
        })
      })
    })
  }
})
.add({
  name: 'pipe into psql COPY',
  defer: true,
  fn: function(d) {
    var c = client();
    c.query('DROP TABLE IF EXISTS plugnumber', function() {
      c.query('CREATE TABLE plugnumber (num int)', function() {
        c.end();
        var seq = inStream();
        var from = cp.spawn(psql, ['postgres', '-c', 'COPY plugnumber FROM STDIN'])
        seq.pipe(from);
        from.on('close', function() {
          d.resolve();
        })
      })
    })
  }
})
.add({
  name: 'pipe into pg-copy-stream COPY',
  defer: true,
  fn: function(d) {
    var c = client();
    c.query('DROP TABLE IF EXISTS plugnumber', function() {
      c.query('CREATE TABLE plugnumber (num int)', function() {
        var seq = inStream()
        var from = c.query(copy('COPY plugnumber FROM STDIN'))
        seq.pipe(from);
        from.on('end', function() {
          c.end();
          d.resolve();
        })
      })
    })
  }
})

.on('cycle', function(event) {
  console.log(String(event.target));
})
.on('complete', function() {
  console.log('Fastest is ' + this.filter('fastest').map('name'));
});


var c = client()
c.query('DROP TABLE IF EXISTS plugnumber', function() {
  c.end();
  suite.run();
})

