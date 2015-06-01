Transform      = require('stream').Transform
codes          = require('./codes')
protocolHelper = require('./protocolHelper')
eventTypes     = ['close', 'data', 'end', 'error']

module.exports = class CopyToQueryStream extends Transform

  constructor: (@text, options) ->
    Transform.call @, options
    @_listeners = {}
    @rowCount = 0
    @firstPass = true
    @remainder = false

  shiftMessage: protocolHelper.shiftMessage

  cleanStream: (chunk) ->
    @connection.stream.pause()
    @_detach()
    @connection.stream.unshift chunk
    @push null
    @connection.stream.resume()

  submit: (@connection) ->
    @connection.query @text
    eventTypes.forEach (type) =>
      @_listeners[type] = @connection.stream.listeners type
      @connection.stream.removeAllListeners type

    @connection.stream.pipe @

  handleError: (e) -> @emit 'error', e

  handleCommandComplete: ->

  handleReadyForQuery: ->

  _detach: ->
    @connection.stream.unpipe()
    eventTypes.forEach (type) =>
      @connection.stream.removeAllListeners type
      @_listeners[type].forEach (listener) =>
        @connection.stream.on type, listener

  _transform: (chunk, enc, cb) ->
    if chunk and @remainder
      chunk = Buffer.concat [@remainder, chunk]

    loop
      { code, length, message, chunk } = @shiftMessage chunk

      # If this is the first time we've been called make sure we got
      # a copy out response message code.
      if @firstPass
        @firstPass = false
        if code is not codes.copyOutResponse
          return @emit 'error', new Error "First message was not a copy out response"

        continue

      # We've exhausted the sane messages in this chunk, grab the
      # remainder and hold it for the next pass.
      if code is null
        @remainder = chunk
        return cb()

      # Ignore these two control messages.
      continue if code is codes.noticeResponse
      continue if code is codes.parameterStatus

      # Postgres has said we're done here.
      if code is codes.close
        # Here we can get the rows affected right from the horse's mouth.
        @rowCount = parseInt message[5..-2].toString('utf8'), 10
        return cb()

      # Something bad happened, stop here.
      if code is codes.error
        @cleanStream chunk
        @emit 'error', new Error "Error during copy: #{ message }"
        return cb()

      # This happens after codes.close, so we should have already called
      # back without getting here.
      if code is codes.readyForQuery
        # really bad stuff happened if we got here.
        @emit 'error', "Got ready for query response before close."
        return cb()

      # We're finished getting actual data elements, we'll get our rows
      # affected here in a bit.
      if code is codes.copyDone
        @cleanStream chunk
        continue

      # Here's a complete row of data.
      if code is codes.copyData
        @push message
        continue

      @emit 'error', new Error "Received unknown message code from server: #{ code }"
