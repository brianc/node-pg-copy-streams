var CopyToQueryStream = require('./copy-to')
module.exports = {
  to: function(txt, options) {
    return new CopyToQueryStream(txt, options)
  },
  from: function (txt, options) {
    return new CopyStreamQuery(txt, options)
  }
}

var Transform = require('stream').Transform
var util = require('util')
var code = require('./message-formats')

var CopyStreamQuery = function(text, options) {
  Transform.call(this, options)
  this.text = text
  this._listeners = null
  this._copyOutResponse = null
  this.rowCount = 0
}

util.inherits(CopyStreamQuery, Transform)

CopyStreamQuery.prototype.submit = function(connection) {
  this.connection = connection
  connection.query(this.text)
}


var copyDataBuffer = Buffer([code.CopyData])
CopyStreamQuery.prototype._transform = function(chunk, enc, cb) {
  this.push(copyDataBuffer)
  var lenBuffer = Buffer(4)
  lenBuffer.writeUInt32BE(chunk.length + 4, 0)
  this.push(lenBuffer)
  this.push(chunk)
  cb()
}

CopyStreamQuery.prototype._flush = function(cb) {
  var finBuffer = Buffer([code.CopyDone, 0, 0, 0, 4])
  this.push(finBuffer)
  //never call this callback, do not close underlying stream
  //cb()
}

CopyStreamQuery.prototype.handleError = function(e) {
  this.emit('error', e)
}

CopyStreamQuery.prototype.handleCopyInResponse = function(connection) {
  this.pipe(connection.stream)
}

CopyStreamQuery.prototype.handleCommandComplete = function(msg) {
  // Parse affected row count as in
  // https://github.com/brianc/node-postgres/blob/35e5567f86774f808c2a8518dd312b8aa3586693/lib/result.js#L37
  var match = /COPY (\d+)/.exec((msg || {}).text)
  if (match) {
    this.rowCount = parseInt(match[1], 10)
  }

  this.unpipe()
  this.emit('end')
}

CopyStreamQuery.prototype.handleReadyForQuery = function() {
}
