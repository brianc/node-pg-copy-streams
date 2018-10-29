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
  }
  
  util.inherits(CopyStreamQuery, Readable)
  
  var eventTypes = ['close', 'data', 'end', 'error']
  
  CopyStreamQuery.prototype.submit = function(connection) {
    connection.query(this.text)
    this.connection = connection
    this.connection.removeAllListeners('copyData')
    this.listeners = connection.stream.listeners('data');
    connection.stream.removeAllListeners('data');
    var self = this;
    connection.stream.on('data', function(chunk) {
      self._process(chunk);
    });
  }
  
  CopyStreamQuery.prototype._detach = function() {
    this.connection.stream.removeAllListeners('data');
    // Unpipe can drop us out of flowing mode
    this.connection.stream.resume()
    for(var i=0;i<this.listeners.length;i++){
      this.connection.stream.addListener('data',this.listeners[i]);
    }
  }
  CopyStreamQuery.prototype._read = function() {
  }

  CopyStreamQuery.prototype._process = function(chunk) {
    var offset = 0
    var Byte1Len = 1;
    var Int32Len = 4;
    if(this._remainder && chunk) {
      chunk = Buffer.concat([this._remainder, chunk])
    }
  
    var length;
    var messageCode;
    var needPush = false;
  
    while((chunk.length - offset) >= (Byte1Len + Int32Len)) {
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
          needPush = true;
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
  
      length = chunk.readUInt32BE(offset+Byte1Len)
      if(chunk.length >= (offset + Byte1Len + length)) {
        offset += Byte1Len + Int32Len
        if (needPush) {
          var row = chunk.slice(offset, offset + length - Int32Len)
          this.rowCount++
          this.push(row)
        }
        offset += (length - Int32Len)
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
  