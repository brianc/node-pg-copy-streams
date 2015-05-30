module.exports = function(txt, options) {
  return new CopyFromQueryStream(txt, options);
};

var Transform      = require('stream').Transform;
var util           = require('util');
var code           = require('./code');
var copyDataBuffer = Buffer([code.d]);

var CopyFromQueryStream = function(text, options) {
  Transform.call(this, options);
  this.text = text;
  this._listeners = null;
  this._copyOutResponse = null;
  this.rowCount = 0;
};

util.inherits(CopyFromQueryStream, Transform);

CopyFromQueryStream.prototype.submit = function(connection) {
  this.connection = connection;
  connection.query(this.text);
};

CopyFromQueryStream.prototype._transform = function(chunk, enc, cb) {
  this.push(copyDataBuffer);
  var lenBuffer = Buffer(4);
  lenBuffer.writeUInt32BE(chunk.length + 4, 0);
  this.push(lenBuffer);
  this.push(chunk);
  this.rowCount++;
  cb();
};

CopyFromQueryStream.prototype._flush = function(cb) {
  var finBuffer = Buffer([code.c, 0, 0, 0, 4]);
  this.push(finBuffer);
  //never call this callback, do not close underlying stream
  //cb()
};

CopyFromQueryStream.prototype.handleError = function(e) {
  this.emit('error', e);
};

CopyFromQueryStream.prototype.handleCopyInResponse = function(connection) {
  this.pipe(connection.stream);
};

CopyFromQueryStream.prototype.handleCommandComplete = function() {
  this.unpipe();
  this.emit('end');
};

CopyFromQueryStream.prototype.handleReadyForQuery = function() { };
