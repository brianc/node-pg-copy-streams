Transform      = require('stream').Transform
codes          = require('./codes')
copyDataBuffer = Buffer([codes.copyData])
finBuffer      = Buffer([codes.copyDone, 0, 0, 0, 4])
eventTypes     = ['close', 'data', 'end', 'error']

module.exports = class CopyToQueryStream extends Transform

  constructor: (@text, options) ->
    Transform.call @, options
    @_listeners = {}
    @_copyOutResponse = null
    @rowCount = 0


  submit: (@connection) ->
    @connection.query @text
    eventTypes.forEach (type) =>
      @_listeners[type] = @connection.stream.listeners type
      @connection.stream.removeAllListeners type

    @connection.stream.pipe @


  handleError: (e) ->
    @emit 'error', e


  handleCommandComplete: ->


  handleReadyForQuery: ->


  _detach: ->
    @connection.stream.unpipe()
    eventTypes.forEach (type) =>
      @connection.stream.removeAllListeners type
      @_listeners[type].forEach (listener) =>
        @connection.stream.on type, listener


  _transform: (chunk, enc, cb) ->
    length = null
    slice  = null
    offset = 0

    if @_remainder and chunk
      chunk = Buffer.concat [@_remainder, chunk]

    if not @_copyOutResponse
      @_copyOutResponse = true

      if chunk[0] is codes.error
        @connection.stream.pause()
        @_detach()
        @connection.stream.unshift chunk
        @push null
        @connection.stream.resume()
        return cb()

      if chunk[0] isnt codes.copyOutResponse
        @emit 'error', new Error 'Expected copy out response'

      length = chunk.readUInt32BE 1
      offset = 1
      offset += length
    # end not @_copyOutResponse

    while (chunk.length - offset) > 5
      messagecodes = chunk[offset]
      if messagecodes is codes.copyDone or messagecodes is codes.error
        @connection.stream.pause()
        @_detach()
        if messagecodes is codes.copyDone
          @connection.stream.unshift(chunk.slice(offset + 5))
        else
          @connection.stream.unshift(chunk.slice(offset))

        @push null
        @connection.stream.resume()
        return cb()
      # end if

      if messagecodes isnt codes.copyData
        return @emit 'error', new Error 'expected "d" (copydata message)'

      length = chunk.readUInt32BE(offset + 1) - 4 # Subtract the len of UInt32

      if chunk.length > (offset + length + 5)
        offset += 5
        slice = chunk.slice offset, offset + length
        offset += length
        @push slice
        @rowCount++
      else
        break
    # end while

    if chunk.length - offset
      slice = chunk.slice offset
      @_remainder = slice
    else
      @_remainder = false

    cb()
