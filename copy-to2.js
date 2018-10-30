module.exports = function(txt, options) {
  return new CopyStreamQuery(txt, options)
}

var Readable = require('stream').Readable
var util = require('util')
var code = require('./message-formats')

var CopyStreamQuery = function(text, options) {
  Readable.call(this, options)
  this.text = text
  this._gotCopyOutResponse = false
  this.rowCount = 0
  this.Byte1Len = 1;
  this.Int32Len = 4;

}

util.inherits(CopyStreamQuery, Readable)

var eventTypes = ['close', 'data', 'end', 'error']

CopyStreamQuery.prototype.submit = function(connection) {
  connection.query(this.text)
  this.connection = connection
  this.connection.removeAllListeners('copyData')
  // remove connection listener to avoid create full length buffer
  this.listeners = connection.stream.listeners('data');
  connection.stream.removeAllListeners('data');
  // put our listener to process copy data
  var self = this;
  this._listener = function(chunk) {
      self._process(chunk);
  };
  connection.stream.on('data', this._listener);
}

CopyStreamQuery.prototype._detach = function() {
  // remove my listener
  this.connection.stream.removeListener('data',this._listener);
  // resume stream
  this.connection.stream.resume()
  // push previous listeners
  for(var i=0;i<this.listeners.length;i++){
    this.connection.stream.addListener('data',this.listeners[i]);
  }
}
CopyStreamQuery.prototype._read = function() {
}

CopyStreamQuery.prototype._pushData = function(chunk, offset) {
  // push data from copy command
  var chunkLength = chunk.length - offset;
  // process the rest of the chunk or bytes rest
  var length = Math.min(this._copyBytesRest, chunkLength);
  var buffer = chunk.slice(offset, offset + length);
  this.push(buffer);
  // substract bytes processed
  this._copyBytesRest -= length;
  if (this._copyBytesRest === 0){
    // finish
    this._copyisCopying = false;
  }
  // return updated offset
  return offset + length;
}

CopyStreamQuery.prototype._process = function(chunk) {
  var offset = 0
  if(this._remainder && chunk) {
    chunk = Buffer.concat([this._remainder, chunk])
  }

  var length;
  var messageCode;
  // if copying data
  if (this._copyisCopying) {
    offset = this._pushData(chunk, offset);
    // if all chunk consumed return
    if (offset === chunk.length) return;
  }

  while((chunk.length - offset) >= (this.Byte1Len + this.Int32Len)) {
    var messageCode = chunk[offset]

    //console.log('PostgreSQL message ' + String.fromCharCode(messageCode))
    switch(messageCode) {

      // detect COPY start
      case code.CopyOutResponse:
        if (!this._gotCopyOutResponse) {
          this._gotCopyOutResponse = true
        } else {
          this.emit('error', new Error('Unexpected CopyOutResponse message (H)'))
        }
        break;

      // meaningful row
      case code.CopyData:
        // signal start copy data and process this chunk
        this._copyisCopying = true;
        this._copyTotalLength = chunk.readUInt32BE(offset+this.Byte1Len) - this.Int32Len;
        this._copyBytesRest = this._copyTotalLength;
        offset = this._pushData(chunk, offset + this.Byte1Len + this.Int32Len);
        continue;
        break;

      // standard interspersed messages. discard
      case code.ParameterStatus:
      case code.NoticeResponse:
      case code.NotificationResponse:
        break;
  
      case code.ErrorResponse:
      case code.CopyDone:
        this._detach()
        if (offset+1 < chunk.length) {
          this.connection.stream.emit('data', chunk.slice(offset));
        }
        this.push(null)
        return;
        break;
      default:
        this.emit('error', new Error('Unexpected PostgreSQL message ' + String.fromCharCode(messageCode)))
    }

    length = chunk.readUInt32BE(offset+this.Byte1Len)
    if(chunk.length >= (offset + this.Byte1Len + length)) {
      offset += this.Byte1Len + this.Int32Len
      offset += (length - this.Int32Len)
    } else {
      // we need more chunks for a complete message
      break;
    }
  }

  if(chunk.length - offset) {
    var slice = chunk.slice(offset)
    this._remainder = slice
  } else {
    this._remainder = false
  }
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
