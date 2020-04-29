var cp = require('duplex-child-process')
var pg = require('pg')

var copy = require('../').from

var client = function () {
  var client = new pg.Client()
  client.connect()
  return client
}

var inStream = function () {
  return cp.spawn('seq', ['0', '29999999'])
}

var running = true

var c = client()
c.query('DROP TABLE IF EXISTS plugnumber', function () {
  c.query('CREATE TABLE plugnumber (num int)', function () {
    var seq = inStream()
    var from = c.query(copy('COPY plugnumber FROM STDIN'))
    seq.pipe(from)
    from.on('end', function () {
      running = false
      c.end()
    })
  })
})

var rssMin = process.memoryUsage().rss / 1024 / 1024
var rssMax = rssMin

memlog = function () {
  var rss = process.memoryUsage().rss / 1024 / 1024
  rssMin = Math.min(rss, rssMin)
  rssMax = Math.max(rss, rssMax)
  console.log(
    'rss:' +
      Math.round(rss * 100) / 100 +
      'MB rssMin:' +
      Math.round(rssMin * 100) / 100 +
      'MB rssMax:' +
      Math.round(rssMax * 100) / 100 +
      'MB'
  )
  if (running) {
    setTimeout(memlog, 1000)
  }
}

memlog()
