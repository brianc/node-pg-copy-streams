Transform      = require('stream').Transform
codes          = require('./codes')
protocolHelper = require('./protocolHelper')

module.exports = class CopyFromQueryStream extends Transform

  constructor: (@text, @options) ->
    Transform.call @, @options
    @rowCount = 0

  createMessage: protocolHelper.createMessage

  submit: (@connection) -> @connection.query @text

  handleError: (e) -> @emit 'error', e

  handleReadyForQuery: ->

  handleCopyInResponse: (@connection) -> @pipe @connection.stream

  handleCommandComplete: (msg, con) ->
    @unpipe()
    @emit 'end'

  # Never call the callback, do not close underlying stream.
  _flush: (cb) -> @push @createMessage codes.copyDone, Buffer 0

  _transform: (chunk, enc, cb) ->
    @push @createMessage codes.copyData, chunk
    @rowCount++
    cb()
