module.exports =
  shiftMessage: (chunk) ->
    out =
      code    : null
      length  : null
      message : null
      chunk   : null

    if chunk.length < 6
      out.chunk = chunk
      return out

    # The first byte is the message type.
    # The next 4 bytes are the message length, including itself.
    out.code    = chunk.toString 'ascii', 0, 1
    out.length  = chunk.readUInt32BE 1
    out.message = chunk.slice 5, out.length + 1
    out.chunk   = chunk.slice out.length + 1

    if (out.message.length + 4) < out.length
      # We don't have all of the message yet.
      out.code    = null
      out.length  = null
      out.message = null
      out.chunk   = chunk
      return out

    return out

  createMessage: (code, chunk) ->
    length = Buffer 4
    length.writeUInt32BE chunk.length + 4, 0 # Our length counts here.
    return Buffer.concat [
      Buffer code
      length
      chunk
    ]
