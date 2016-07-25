module.exports = function(txt, options) {
  return new CopyStreamQuery(txt, options)
}

var Transform = require('stream').Transform
var util = require('util')
var code = require('./message-formats')

var CopyStreamQuery = function(text, options) {
  Transform.call(this, options)
  this.text = text
  this._copyOutResponse = null
  this.rowCount = 0
}

util.inherits(CopyStreamQuery, Transform)

var eventTypes = ['close', 'data', 'end', 'error']

CopyStreamQuery.prototype.submit = function(connection) {
  connection.query(this.text)
  this.connection = connection
  this.connection.removeAllListeners('copyData')
  connection.stream.pipe(this)
}

CopyStreamQuery.prototype._detach = function() {
  this.connection.stream.unpipe(this)
  // Unpipe can drop us out of flowing mode
  this.connection.stream.resume()
}


CopyStreamQuery.prototype._transform = function(chunk, enc, cb) {
  var offset = 0
  var Byte1Len = 1;
  var Int32Len = 4;
  if(this._remainder && chunk) {
    chunk = Buffer.concat([this._remainder, chunk])
  }
  if(!this._copyOutResponse) {
    this._copyOutResponse = true
    if(chunk[offset] == code.ErrorResponse) {
      this._detach()
      this.push(null)
      return cb();
    }
    if(chunk[offset] != code.CopyOutResponse) {
      this.emit('error', new Error('Expected CopyOutResponse code (H)'))
    }
    var length = chunk.readUInt32BE(offset+Byte1Len)
    offset += Byte1Len + length
  }
  while((chunk.length - offset) > (Byte1Len + Int32Len)) {
    var messageCode = chunk[offset]
    //complete or error
    if(messageCode == code.CopyDone || messageCode == code.ErrorResponse) {
      this._detach()
      this.push(null)
      return cb();
    }
    //something bad happened
    if(messageCode != code.CopyData) {
      return this.emit('error', new Error('Expected CopyData code (d)'))
    }
    var length = chunk.readUInt32BE(offset + Byte1Len) - Int32Len
    //can we read the next row?
    if(chunk.length > (offset + Byte1Len + Int32Len + length)) {
      offset += Byte1Len + Int32Len
      var slice = chunk.slice(offset, offset + length)
      offset += length
      this.push(slice)
      this.rowCount++
    } else {
      break;
    }
  }
  if(chunk.length - offset) {
    var slice = chunk.slice(offset)
    this._remainder = slice
  } else {
    this._remainder = false
  }
  cb()
}

CopyStreamQuery.prototype.handleError = function(e) {
  this.emit('error', e)
}

CopyStreamQuery.prototype.handleCopyData = function(chunk) {
}

CopyStreamQuery.prototype.handleCommandComplete = function() {
}

CopyStreamQuery.prototype.handleReadyForQuery = function() {
}
