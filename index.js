'use strict'

const CopyToQueryStream = require('./copy-to')
module.exports = {
  to: function (txt, options) {
    return new CopyToQueryStream(txt, options)
  },
  from: function (txt, options) {
    return new CopyStreamQuery(txt, options)
  },
}

const { Transform } = require('stream')
const code = require('./message-formats')

class CopyStreamQuery extends Transform {
  constructor(text, options) {
    super(options)
    this.text = text
    this._listeners = null
    this._copyOutResponse = null
    this.rowCount = 0
  }

  submit(connection) {
    this.connection = connection
    connection.query(this.text)
  }

  _transform(chunk, enc, cb) {
    const Int32Len = 4
    const lenBuffer = Buffer.from([code.CopyData, 0, 0, 0, 0])
    lenBuffer.writeUInt32BE(chunk.length + Int32Len, 1)
    this.push(lenBuffer)
    this.push(chunk)
    cb()
  }

  _flush(cb) {
    const Int32Len = 4
    const finBuffer = Buffer.from([code.CopyDone, 0, 0, 0, Int32Len])
    this.push(finBuffer)
    this.cb_flush = cb
  }

  handleError(e) {
    this.emit('error', e)
  }

  handleCopyInResponse(connection) {
    this.pipe(connection.stream, { end: false })
  }

  handleCommandComplete(msg) {
    // Parse affected row count as in
    // https://github.com/brianc/node-postgres/blob/35e5567f86774f808c2a8518dd312b8aa3586693/lib/result.js#L37
    const match = /COPY (\d+)/.exec((msg || {}).text)
    if (match) {
      this.rowCount = parseInt(match[1], 10)
    }

    // we delay the _flush cb so that the 'end' event is
    // triggered after CommandComplete
    this.cb_flush()

    // unpipe from connection
    this.unpipe(this.connection.stream)
    this.connection = null
  }

  handleReadyForQuery() {}
}
