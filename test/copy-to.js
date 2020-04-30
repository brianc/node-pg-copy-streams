'use strict'

var assert = require('assert')
var gonna = require('gonna')

var _ = require('lodash')
var async = require('async')
var concat = require('concat-stream')
var Writable = require('stream').Writable
var pg = require('pg')

var copy = require('../').to
var code = require('../message-formats')

var client = function () {
  var client = new pg.Client()
  client.connect()
  return client
}

describe('copy-to', () => {
  it('test construction', () => {
    var txt = 'COPY (SELECT * FROM generate_series(0, 10)) TO STDOUT'
    var stream = copy(txt, { highWaterMark: 10 })
    assert.equal(stream._readableState.highWaterMark, 10, 'Client should have been set with a correct highWaterMark.')
  })

  it('test range', (done) => {
    var top = 10000
    var fromClient = client()
    var txt = 'COPY (SELECT * from generate_series(0, ' + (top - 1) + ')) TO STDOUT'
    var res

    var stream = fromClient.query(copy(txt))
    var donePiping = gonna('finish piping out', 1000, function () {
      fromClient.end()
    })

    stream.pipe(
      concat(function (buf) {
        res = buf.toString('utf8')
      })
    )

    stream.on('end', function () {
      var expected = _.range(0, top).join('\n') + '\n'
      assert.equal(res, expected)
      assert.equal(stream.rowCount, top, 'should have rowCount ' + top + ' but got ' + stream.rowCount)
      donePiping()
      done()
    })
  })

  it('test internal postgres error', (done) => {
    var cancelClient = client()
    var queryClient = client()

    var runStream = function (callback) {
      var txt = 'COPY (SELECT pg_sleep(10)) TO STDOUT'
      var stream = queryClient.query(copy(txt))
      stream.on('data', function (data) {
        // Just throw away the data.
      })
      stream.on('error', callback)

      setTimeout(function () {
        var cancelQuery =
          "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query ~ 'pg_sleep' AND NOT query ~ 'pg_cancel_backend'"
        cancelClient.query(cancelQuery, function () {
          cancelClient.end()
        })
      }, 50)
    }

    runStream(function (err) {
      assert.notEqual(err, null)
      var expectedMessage = 'canceling statement due to user request'
      assert.notEqual(
        err.toString().indexOf(expectedMessage),
        -1,
        'Error message should mention reason for query failure.'
      )
      queryClient.end()
      done()
    })
  })

  it('test NoticeResponse', (done) => {
    // on the copy stream.
    var queryClient = client()
    var set = ''
    set += 'SET SESSION client_min_messages = WARNING;'
    set += 'SET SESSION standard_conforming_strings = off;'
    set += 'SET SESSION escape_string_warning = on;'
    queryClient.query(set, function (err, res) {
      assert.equal(err, null, 'testNoticeResponse - could not SET parameters')
      var runStream = function (callback) {
        var txt = "COPY (SELECT '\\\n') TO STDOUT"
        var stream = queryClient.query(copy(txt))
        stream.on('data', function (data) {})
        stream.on('error', callback)

        // make sure stream is pulled from
        stream.pipe(concat(callback.bind(null, null)))
      }

      runStream(function (err) {
        assert.equal(err, null, err)
        queryClient.end()
        done()
      })
    })
  })

  it('test client reuse', (done) => {
    var c = client()
    var limit = 100000
    var countMax = 10
    var countA = countMax
    var countB = 0
    var runStream = function (num, callback) {
      var sql = 'COPY (SELECT * FROM generate_series(0,' + limit + ')) TO STDOUT'
      var stream = c.query(copy(sql))
      stream.on('error', callback)
      stream.pipe(
        concat(function (buf) {
          var res = buf.toString('utf8')
          var exp = _.range(0, limit + 1).join('\n') + '\n'
          assert.equal(res, exp, 'clientReuse: sent & received buffer should be equal')
          countB++
          callback()
        })
      )
    }

    var rs = function (err) {
      assert.equal(err, null, err)
      countA--
      if (countA) {
        runStream(countB, rs)
      } else {
        assert.equal(countB, countMax, 'clientReuse: there should be countMax queries on the same client')
        c.end()
        done()
      }
    }

    runStream(countB, rs)
  })

  it('test client flowing state', (done) => {
    var donePiping = gonna('finish piping out')
    var clientQueryable = gonna('client is still queryable after piping has finished')
    var c = client()

    // uncomment the code to see pausing and resuming of the connection stream

    //const orig_resume = c.connection.stream.resume;
    //const orig_pause = c.connection.stream.pause;
    //
    //c.connection.stream.resume = function () {
    //  console.log('resume', new Error().stack);
    //  orig_resume.apply(this, arguments)
    //}
    //
    //c.connection.stream.pause = function () {
    //  console.log('pause', new Error().stack);
    //  orig_pause.apply(this, arguments)
    //}

    var testConnection = function () {
      c.query('SELECT 1', function () {
        clientQueryable()
        c.end()
        done()
      })
    }

    var writable = new Writable({
      write: function (chunk, encoding, cb) {
        cb()
      },
    })
    writable.on('finish', function () {
      donePiping()
      setTimeout(testConnection, 100) // test if the connection didn't drop flowing state
    })

    var sql = 'COPY (SELECT 1) TO STDOUT'
    var stream = c.query(copy(sql, { highWaterMark: 1 }))
    stream.pipe(writable)
  })
})
