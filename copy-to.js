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
  if(this._remainder && chunk) {
    chunk = Buffer.concat([this._remainder, chunk])
  }
  if(!this._copyOutResponse) {
    this._copyOutResponse = true
    if(chunk[0] == code.E) {
      this._detach()
      this.push(null)
      return cb();
    }
    if(chunk[0] != code.H) {
      this.emit('error', new Error('Expected copyOutResponse code (H)'))
    }
    var length = chunk.readUInt32BE(1)
    offset = 1
    offset += length
  }
  while((chunk.length - offset) > 5) {
    var messageCode = chunk[offset]
    //complete or error
    if(messageCode == code.c || messageCode == code.E) {
      this._detach()
      this.push(null)
      return cb();
    }
    //something bad happened
    if(messageCode != code.d) {
      return this.emit('error', new Error('Expected copyData code (d)'))
    }
    var length = chunk.readUInt32BE(offset + 1) - 4 //subtract length of UInt32
    //can we read the next row?
    if(chunk.length > (offset + length + 5)) {
      offset += 5
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
