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
    this.cb_CopyInResponse = null
    this.cb_ReadyForQuery = null
    this.cb_destroy = null
    this.cork()
  }

  submit(connection) {
    this.connection = connection
    connection.query(this.text)
  }

  callback() {
    // this callback is empty but defining it allows
    // `pg` to discover it and overwrite it
    // with its timeout mechanism when query_timeout config is set
  }

  _write(chunk, enc, cb) {
    this.chunks.push({ chunk: chunk, encoding: enc })
    if (this._gotCopyInResponse) {
      return this.flush(cb)
    }
    this.cb_CopyInResponse = cb
  }

  _writev(chunks, cb) {
    // this.chunks.push(...chunks)
    // => issue #136, RangeError: Maximum call stack size exceeded
    // Using hybrid approach as advised on https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply
    if (this.chunks.length == 0) {
      this.chunks = chunks
    } else {
      // https://stackoverflow.com/questions/22747068/is-there-a-max-number-of-arguments-javascript-functions-can-accept
      // 100K seems to be a reasonable size for v8
      const QUANTUM = 125000
      for (let i = 0; i < chunks.length; i += QUANTUM) {
        this.chunks.push(...chunks.slice(i, Math.min(i + QUANTUM, chunks.length)))
      }
    }
    if (this._gotCopyInResponse) {
      return this.flush(cb)
    }
    this.cb_CopyInResponse = cb
  }

  _destroy(err, cb) {
    // writable.destroy([error]) was called.
    // send a CopyFail message that will rollback the COPY operation.
    // the cb will be called only after the ErrorResponse message is received
    // from the backend
    if (this.cb_ReadyForQuery) return cb(err)
    this.cb_destroy = cb
    const msg = err ? err.message : 'NODE-PG-COPY-STREAMS destroy() was called'
    const self = this
    const done = function () {
      self.connection.sendCopyFail(msg)
    }

    this.chunks = []
    if (this._gotCopyInResponse) {
      return this.flush(done)
    }
    this.cb_CopyInResponse = done
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
    this.cb_CopyInResponse = done
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
    // clear `pg` timeout mechanism
    this.callback()

    if (this.cb_destroy) {
      const cb = this.cb_destroy
      this.cb_destroy = null
      cb(e)
    } else {
      this.emit('error', e)
    }
    this.connection = null
  }

  handleCopyInResponse(connection) {
    this._gotCopyInResponse = true
    if (!this.destroyed) {
      this.uncork()
    }
    const cb = this.cb_CopyInResponse || function () {}
    this.cb_CopyInResponse = null
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
    // sent only when the ingested data is visible inside postgres and
    // after the postgres connection is ready for a new query

    // Note: `pg` currently does not call this callback when the backend
    // sends an ErrorResponse message during the query (for example during
    // a CopyFail)

    // clear `pg` timeout mechanism
    this.callback()

    this.cb_ReadyForQuery()
    this.connection = null
  }
}
