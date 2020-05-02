const cp = require('duplex-child-process')
const pg = require('pg')

const copy = require('../').from

const client = function () {
  const client = new pg.Client()
  client.connect()
  return client
}

const inStream = function () {
  return cp.spawn('seq', ['0', '29999999'])
}

let running = true

const c = client()
c.query('DROP TABLE IF EXISTS plugnumber', function () {
  c.query('CREATE TABLE plugnumber (num int)', function () {
    const seq = inStream()
    const from = c.query(copy('COPY plugnumber FROM STDIN'))
    seq.pipe(from)
    from.on('end', function () {
      running = false
      c.end()
    })
  })
})

let rssMin = process.memoryUsage().rss / 1024 / 1024
let rssMax = rssMin

memlog = function () {
  const rss = process.memoryUsage().rss / 1024 / 1024
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
