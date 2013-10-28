var assert = require('assert')
var gonna = require('gonna')

var concat = require('concat-stream')
var _ = require('lodash')
var pg = require('pg.js')

var testRange = function(top) {
  var client = function() {
    var client = new pg.Client()
    client.connect()
    return client
  }

  var fromClient = client()
  var copy = require('../').to

  var txt = 'COPY (SELECT * from generate_series(0, ' + top + ')) TO STDOUT'

  var stream = fromClient.query(copy(txt))
  var done = gonna('finish piping out', 1000, function() {
    fromClient.end()
  })

  stream.pipe(concat(function(buf) {
    var res = buf.toString('utf8')
    var expected = _.range(0, top+1).join('\n') + '\n'
    assert.equal(res, expected)
    done()
  }))
}

testRange(10000)
