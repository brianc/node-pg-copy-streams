Transform      = require('stream').Transform
codes          = require('./codes')
copyDataBuffer = Buffer([codes.copyData])
finBuffer      = Buffer([codes.copyDone, 0, 0, 0, 4])

module.exports = class CopyFromQueryStream extends Transform

  constructor: (@text, @options) ->
    Transform.call @, @options
    @rowCount = 0


  submit: (@connection) ->
    @connection.query @text


  handleError: (e) ->
    @emit 'error', e


  handleCommandComplete: (msg, con) ->
    @unpipe()
    @emit 'end'


  handleReadyForQuery: ->


  handleCopyInResponse: (@connection) ->
    @pipe @connection.stream


  _flush: (cb) ->
    @push finBuffer
    # Never call the callback, do not close underlying stream.


  _transform: (chunk, enc, cb) ->
    @push copyDataBuffer
    lenBuffer = Buffer 4
    lenBuffer.writeUInt32BE chunk.length + 4, 0
    @push lenBuffer
    @push chunk
    @rowCount++
    cb()
