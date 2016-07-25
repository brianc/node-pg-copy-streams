/**
 * The COPY feature uses the following protocol codes.
 * The codes for the most recent protocol version are documented on
 * https://www.postgresql.org/docs/current/static/protocol-message-formats.html
 * 
 * The protocol flow itself is described on
 * https://www.postgresql.org/docs/current/static/protocol-flow.html
 */
module.exports = {
  E: 0x45, //Error
  G: 0x47, //CopyInResponse
  H: 0x48, //CopyOutResponse
  W: 0x57, //CopyBothResponse
  d: 0x64, //CopyData
  c: 0x63, //CopyDone
  f: 0x66  //CopyFail
} 
