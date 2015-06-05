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
    # If we have a remainder from the last iteration ensure that we
    # start with it.
    if chunk and @remainder
      chunk = Buffer.concat [@remainder, chunk]

    # This loop will operate until we can't get any more messages out
    # of the chunk or something bad happens.
    loop
      { code, length, message, chunk } = @shiftMessage chunk

      # If this is the first time we've been called make sure we got
      # a copy out response message code.
      if @firstPass
        @firstPass = false
        if code isnt codes.copyOutResponse
          @emit 'error', new Error "First message was not a copy out response"
          return cb()

        continue

      switch code

        when codes.copyData
          # Here's a complete row of data.
          @push message
          continue

        when null
          # We've exhausted the sane messages in this chunk, grab the
          # remainder and hold it for the next pass.
          @remainder = chunk
          return cb()

        when codes.copyDone
          # We're finished getting actual data elements, we'll get our rows
          # affected here in a bit.
          @cleanStream chunk
          continue

        when codes.close
          # Postgres has said we're done here. We can get the rows
          # affected right from the horse's mouth.
          @rowCount = parseInt message[5..-2].toString('utf8'), 10
          return cb()

        when codes.error
          # Something bad happened, stop here.
          @cleanStream chunk
          @emit 'error', new Error "Error during copy: #{ message }"
          return cb()

        when codes.noticeResponse, codes.parameterStatus, codes.notificationResponse
          # http://www.postgresql.org/docs/9.4/static/protocol-flow.html#COPY-Operations
          #
          # > It is possible for NoticeResponse and ParameterStatus messages to
          # > be interspersed between CopyData messages; frontends must handle
          # > these cases, and should be prepared for other asynchronous message
          # > types as well (see Section 49.2.6). Otherwise, any message type
          # > other than CopyData or CopyDone may be treated as terminating
          # > copy-out mode.
          continue

        else
          @emit 'error', new Error "Received unexpected code: #{ code }"
          return cb()
