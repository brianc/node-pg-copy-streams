module.exports = function(txt) {
  return new CopyStreamQuery(txt)
}

var Transform = require('stream').Transform
var util = require('util')

var CopyStreamQuery = function(text) {
  Transform.call(this)
  this.text = text
  this._listeners = null
  this._copyOutResponse = null
  this.rowsRead = 0
}

util.inherits(CopyStreamQuery, Transform)

CopyStreamQuery.prototype.submit = function(connection) {
  console.log('submitting')
  connection.query(this.text)
  this.connection = connection
  this._listeners = connection.stream.listeners('data')
  connection.stream.removeAllListeners('data')
  connection.stream.pipe(this)
}

var code = {
  E: 69, //Error
  H: 72, //CopyOutResponse
  d: 0x64, //CopyData
  c: 0x63 //CopyDone
}

CopyStreamQuery.prototype._detach = function() {
  this.connection.stream.unpipe()
  this.connection.stream.removeAllListeners('data')
  var self = this
  this._listeners.forEach(function(listener) {
    self.connection.stream.on('data', listener)
  })
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
      this.connection.stream.unshift(chunk)
      this.push(null)
      return cb();
    }
    if(chunk[0] != code.H) {
      this.emit('error', new Error('Expected copy out response'))
    }
    var length = chunk.readUInt32BE(1)
    offset = 1
    offset += length
  }
  while((chunk.length - offset) > 5) {
    var messageCode = chunk[offset]
    //complete
    if(messageCode == code.c) {
      this._detach()
      this.connection.stream.unshift(chunk.slice(offset + 5))
      this.push(null)
      return cb();
    }
    //something bad happened
    if(messageCode != code.d) {
      return this.emit('error', new Error('expected "d" (copydata message)'))
    }
    var length = chunk.readUInt32BE(offset + 1) - 4 //subtract length of UInt32
    //can we read the next row?
    if(chunk.length > (offset + length + 5)) {
      offset += 5
      var slice = chunk.slice(offset, offset + length)
      offset += length
      this.rowsRead++
      this.push(slice)
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

CopyStreamQuery.prototype.handleCommandComplete = function() {
}

CopyStreamQuery.prototype.handleReadyForQuery = function() {
}
