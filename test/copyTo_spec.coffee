describe 'copy to', ->

  async  = require('async')
  concat = require('concat-stream')
  copyTo = require('../src/').to

  it 'should set up a correct highWaterMark', ->
    txt    = "COPY (SELECT * FROM generate_series(0, 10)) TO STDOUT"
    stream = copyTo txt, highWaterMark: 10
    expect(stream._readableState.highWaterMark).to.equal(10)

  it 'should return the correct rows', (done) ->
    client = getClient()
    txt    = "COPY (SELECT * from generate_series(0, 999)) TO STDOUT"
    stream = client.query copyTo txt

    stream.on 'end', ->
      client.end()

    stream.pipe concat (buf) ->
      res      = buf.toString 'utf8'
      expected = [0...1000].join('\n') + '\n'
      expect(res).to.equal(expected)
      expect(stream.rowCount).to.equal(1000)
      done()

  it 'should deal with really large messages', (done) ->
    client = getClient()
    txt    = "COPY (SELECT lpad('', 1000000, 'a')) TO STDOUT"
    stream = client.query copyTo txt

    stream.on 'end', ->
      client.end()

    stream.pipe concat (buf) ->
      res = buf.toString 'utf8'
      # 10001 because it ends with a \n
      expect(res.length).to.equal(1000001)
      done()

  it 'should not leak listeners between calls', (done) ->
    client = getClient()
    nClose = client.connection.stream.listeners('close').length
    nData  = client.connection.stream.listeners('data').length
    nEnd   = client.connection.stream.listeners('end').length
    nError = client.connection.stream.listeners('error').length

    txt = "COPY (SELECT 10) TO STDOUT"

    runStream = (num, cb) ->
      stream = client.query copyTo txt
      stream.on 'data', (data) ->
      stream.on 'end', cb
      stream.on 'error', cb

    async.timesSeries 5, runStream, (err) ->
      expect(err).to.be.null
      client.end()
      expect(client.connection.stream.listeners('close').length).to.equal(nClose)
      expect(client.connection.stream.listeners('data').length).to.equal(nData)
      expect(client.connection.stream.listeners('end').length).to.equal(nEnd)
      expect(client.connection.stream.listeners('error').length).to.equal(nError)
      done()

  it 'should error when a query is cancelled inside Postgres', (done) ->
    client       = getClient()
    cancelClient = getClient()

    runStream = (cb) ->
      txt = "COPY (SELECT pg_sleep(10)) TO STDOUT"
      stream = client.query copyTo txt
      stream.on 'data', (data) ->
      stream.on 'error', cb

      c = -> cancelClient.query """
        SELECT pg_cancel_backend(pid)
        FROM pg_stat_activity
        WHERE query ~ 'pg_sleep'
         AND NOT query ~ 'pg_cancel_backend'
      """
      setTimeout c, 25

    runStream (err) ->
      expect(err).to.not.be.null
      client.end()
      cancelClient.end()
      done()
