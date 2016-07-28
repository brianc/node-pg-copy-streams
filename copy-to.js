module.exports = function(txt, options) {
  return new CopyStreamQuery(txt, options)
}

var Transform = require('stream').Transform
var util = require('util')
var code = require('./message-formats')

var CopyStreamQuery = function(text, options) {
  Transform.call(this, options)
  this.text = text
  this._gotCopyOutResponse = false
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
  if(!this._gotCopyOutResponse) {
    this._gotCopyOutResponse = true
    if(chunk[0] == code.ErrorResponse) {
      this._detach()
      this.push(null)
      return cb();
    }
    if(chunk[0] != code.CopyOutResponse) {
      this.emit('error', new Error('Expected CopyOutResponse code (H)'))
    }
    var length = chunk.readUInt32BE(1)
    offset = 1
    offset += length
  }
  while((chunk.length - offset) > 5) {
    var messageCode = chunk[offset]
    //early bail out of copy-out operation
    if(messageCode == code.CopyDone || messageCode == code.ErrorResponse) {
      this._detach()
      this.push(null)
      return cb();
    }
    //we can handle the message only when no more chunks are needed
    var length = chunk.readUInt32BE(offset + 1) - 4
    if(chunk.length > (offset + length + 5)) {
      offset += 5
      if (messageCode === code.CopyData) {
        // note that in binary mode,
        // - the first row begins with the header
        // - the last row finishes with the trailer
        var row = chunk.slice(offset, offset + length)
        this.rowCount++;
        this.push(row);
      } else if ([code.NotificationResponse,
                  code.NoticeResponse,
                  code.ParameterStatus].indexOf(messageCode) === -1) {
          return this.emit('error', new Error('Unexpected message interspersed between CopyData messages'))
      }
      offset += length
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
