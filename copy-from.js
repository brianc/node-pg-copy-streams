'use strict'

module.exports = function (txt, options) {
  return new CopyStreamQuery(txt, options)
}

const { Writable } = require('stream')
const code = require('./message-formats')

class CopyStreamQuery extends Writable {
  constructor(text, options) {
    super(options)
    this.text = text
    this.rowCount = 0
    this._gotCopyInResponse = false
    this.chunks = []
    this.cb = null
    this.cork()
  }

  submit(connection) {
    this.connection = connection
    connection.query(this.text)
  }

  _write(chunk, enc, cb) {
    this.chunks.push({ chunk: chunk, encoding: enc })
    if (this._gotCopyInResponse) {
      return this.flush(cb)
    }
    this.cb = cb
  }

  _writev(chunks, cb) {
    this.chunks.push(...chunks)
    if (this._gotCopyInResponse) {
      return this.flush(cb)
    }
    this.cb = cb
  }

  _final(cb) {
    this.cb_ReadyForQuery = cb

    const self = this
    const done = function () {
      const Int32Len = 4
      const finBuffer = Buffer.from([code.CopyDone, 0, 0, 0, Int32Len])
      self.connection.stream.write(finBuffer)
    }

    if (this._gotCopyInResponse) {
      return this.flush(done)
    }
    this.cb = done
  }

  flush(callback) {
    let chunk
    let ok = true
    while (ok && (chunk = this.chunks.shift())) {
      ok = this.flushChunk(chunk.chunk)
    }
    if (callback) {
      if (ok) {
        callback()
      } else {
        if (this.chunks.length) {
          this.connection.stream.once('drain', this.flush.bind(this, callback))
        } else {
          this.connection.stream.once('drain', callback)
        }
      }
    }
  }

  flushChunk(chunk) {
    const Int32Len = 4
    const lenBuffer = Buffer.from([code.CopyData, 0, 0, 0, 0])
    lenBuffer.writeUInt32BE(chunk.length + Int32Len, 1)
    this.connection.stream.write(lenBuffer)
    return this.connection.stream.write(chunk)
  }

  handleError(e) {
    this.emit('error', e)
  }

  handleCopyInResponse(connection) {
    this._gotCopyInResponse = true
    this.uncork()
    const cb = this.cb || function () {}
    this.cb = null
    this.flush(cb)
  }

  handleCommandComplete(msg) {
    // Parse affected row count as in
    // https://github.com/brianc/node-postgres/blob/35e5567f86774f808c2a8518dd312b8aa3586693/lib/result.js#L37
    const match = /COPY (\d+)/.exec((msg || {}).text)
    if (match) {
      this.rowCount = parseInt(match[1], 10)
    }
  }

  handleReadyForQuery() {
    // triggered after ReadyForQuery
    // we delay the _final callback so that the 'finish' event is
    // sent only after the postgres connection is ready for a new query
    this.cb_ReadyForQuery()
    this.connection = null
  }
}
