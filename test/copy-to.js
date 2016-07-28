var assert = require('assert')
var gonna = require('gonna')

var _ = require('lodash')
var async = require('async')
var concat = require('concat-stream')
var pg = require('pg')

var copy = require('../').to
var code = require('../message-formats')

var client = function() {
  var client = new pg.Client()
  client.connect()
  return client
}

var testConstruction = function() {
  var txt = 'COPY (SELECT * FROM generate_series(0, 10)) TO STDOUT'
  var stream = copy(txt, {highWaterMark: 10})
  assert.equal(stream._readableState.highWaterMark, 10, 'Client should have been set with a correct highWaterMark.')
}

testConstruction()

var testComparators = function() {
  var copy1 = copy();
  copy1.pipe(concat(function(buf) {
    assert(copy1._gotCopyOutResponse, 'should have received CopyOutResponse')
    assert(!copy1._remainder, 'Message with no additional data (len=Int4Len+0) should not leave a remainder')
  }))
  copy1.end(new Buffer([code.CopyOutResponse, 0x00, 0x00, 0x00, 0x04])); 


}
testComparators();

var testRange = function(top) {
  var fromClient = client()
  var txt = 'COPY (SELECT * from generate_series(0, ' + (top - 1) + ')) TO STDOUT'
  var res;


  var stream = fromClient.query(copy(txt))
  var done = gonna('finish piping out', 1000, function() {
    fromClient.end()
  })

  stream.pipe(concat(function(buf) {
    res = buf.toString('utf8')
  }))

  stream.on('end', function() {
    var expected = _.range(0, top).join('\n') + '\n'
    assert.equal(res, expected)
    assert.equal(stream.rowCount, top, 'should have rowCount ' + top + ' but got ' + stream.rowCount)
    done()
  });
}

testRange(10000)

var testInternalPostgresError = function() {
  var cancelClient = client()
  var queryClient = client()

  var runStream = function(callback) {
    var txt = "COPY (SELECT pg_sleep(10)) TO STDOUT"
    var stream = queryClient.query(copy(txt))
    stream.on('data', function(data) {
      // Just throw away the data.
    })
    stream.on('error', callback)

    setTimeout(function() {
      var cancelQuery = "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query ~ 'pg_sleep' AND NOT query ~ 'pg_cancel_backend'"
      cancelClient.query(cancelQuery)
    }, 50)
  }

  runStream(function(err) {
    assert.notEqual(err, null)
    var expectedMessage = 'canceling statement due to user request'
    assert.notEqual(err.toString().indexOf(expectedMessage), -1, 'Error message should mention reason for query failure.')
    cancelClient.end()
    queryClient.end()
  })
}
testInternalPostgresError()

var testNoticeResponse = function() {
  // we use a special trick to generate a warning
  // on the copy stream.
  var queryClient = client()
  var set = '';
  set += 'SET SESSION client_min_messages = WARNING;'
  set += 'SET SESSION standard_conforming_strings = off;'
  set += 'SET SESSION escape_string_warning = on;'
  queryClient.query(set, function(err, res) {
    assert.equal(err, null, 'testNoticeResponse - could not SET parameters')
    var runStream = function(callback) {
      var txt = "COPY (SELECT '\\\n') TO STDOUT"
      var stream = queryClient.query(copy(txt))
      stream.on('data', function(data) {
      })
      stream.on('error', callback)
     
      // make sure stream is pulled from 
      stream.pipe(concat(callback.bind(null,null)))
    }

    runStream(function(err) {
      assert.equal(err, null, err)
      queryClient.end()
    })

  })
}

testNoticeResponse();


