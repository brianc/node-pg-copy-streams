describe 'copy from', ->

  async    = require('async')
  copyFrom = require('../src/').from

  it 'should set up a correct highWaterMark', ->
    txt    = "COPY (SELECT * FROM generate_series(0, 10)) TO STDOUT"
    stream = copyFrom txt, highWaterMark: 10
    expect(stream._readableState.highWaterMark).to.equal(10)

  it 'should return the correct rows', (done) ->
    client = getClient()
    txt = "CREATE TEMP TABLE numbers(num int, bigger_num int)"
    client.query txt, (err, result) ->
      rowEmitCount = 0
      txt          = "COPY numbers FROM STDIN"
      stream       = client.query copyFrom txt

      stream.on 'row', -> rowEmitCount++
      stream.write Buffer "#{ i }\t#{ i * 10 }\n" for i in [0..999]
      stream.end()
      stream.on 'end', ->
        txt = "SELECT COUNT(*) FROM numbers"
        client.query txt, (err, result) ->
          expect(err).to.be.null
          expect(result.rows[0].count).to.equal('1000')
          expect(stream.rowCount).to.equal(1000)
          txt = "SELECT (MAX(num)) AS num FROM numbers"
          client.query txt, (err, result) ->
            expect(err).to.be.null
            expect(result.rows[0].num).to.equal(999)
            client.end()
            done()
