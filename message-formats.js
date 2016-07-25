/**
 * The COPY feature uses the following protocol codes.
 * The codes for the most recent protocol version are documented on
 * https://www.postgresql.org/docs/current/static/protocol-message-formats.html
 * 
 * The protocol flow itself is described on
 * https://www.postgresql.org/docs/current/static/protocol-flow.html
 */
module.exports = {
  ErrorResponse:    0x45,
  CopyInResponse:   0x47,
  CopyOutResponse:  0x48,
  CopyBothResponse: 0x57,
  CopyData:         0x64,
  CopyDone:         0x63,
  CopyFail:         0x66
} 
