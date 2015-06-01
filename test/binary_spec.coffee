describe 'binary', ->

  async = require('async')
  _     = require('lodash')
  from  = require('../src/').from
  to    = require('../src/').to

  it 'should allow binary copies', (done) ->
    fromClient = getClient()
    toClient   = getClient()

    queries = [
      "DROP TABLE IF EXISTS data"
      "CREATE TABLE IF NOT EXISTS data (num BIGINT, word TEXT)"
      "INSERT INTO data (num, word) VALUES (1, 'hello'), (2, 'other thing'), (3, 'goodbye')"
      "DROP TABLE IF EXISTS data_copy"
      "CREATE TABLE IF NOT EXISTS data_copy (LIKE data INCLUDING ALL)"
    ]

    async.eachSeries queries, _.bind(fromClient.query, fromClient), (err) ->
      expect(err).to.be.null

      fromStream = fromClient.query to 'COPY (SELECT * FROM data) TO STDOUT BINARY'
      toStream   = toClient.query from 'COPY data_copy FROM STDIN BINARY'

      runStream = (cb) ->
        fromStream.on 'error', cb
        toStream.on 'error', cb
        toStream.on 'end', cb
        fromStream.pipe toStream

      runStream (err) ->
        expect(err).to.be.undefined
        toClient.query "SELECT * FROM data_copy ORDER BY num", (err, result) ->
          expect(result.rowCount).to.equal(3)
          expect(result.rows[0].num).to.equal('1')
          expect(result.rows[0].word).to.equal('hello')
          expect(result.rows[1].num).to.equal('2')
          expect(result.rows[1].word).to.equal('other thing')
          expect(result.rows[2].num).to.equal('3')
          expect(result.rows[2].word).to.equal('goodbye')
          queries = [
            "DROP TABLE data"
            "DROP TABLE data_copy"
          ]
          async.each queries, _.bind(fromClient.query, fromClient), (err) ->
            expect(err).to.be.null
            fromClient.end()
            toClient.end()
            done()
