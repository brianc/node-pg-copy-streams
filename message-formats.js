/**
 * The COPY feature uses the following protocol codes.
 * The codes for the most recent protocol version are documented on
 * https://www.postgresql.org/docs/current/static/protocol-message-formats.html
 *
 * The protocol flow itself is described on
 * https://www.postgresql.org/docs/current/static/protocol-flow.html
 */
module.exports = {
  ErrorResponse: 0x45, // E
  CopyInResponse: 0x47, // G
  CopyOutResponse: 0x48, // H
  CopyBothResponse: 0x57, // W
  CopyDone: 0x63, // c
  CopyData: 0x64, // d
  CopyFail: 0x66, // f
  CommandComplete: 0x43, // C
  ReadyForQuery: 0x5a, // Z

  // It is possible for NoticeResponse and ParameterStatus messages to be interspersed between CopyData messages;
  // frontends must handle these cases, and should be prepared for other asynchronous message types as well
  // (see Section 50.2.6).
  // Otherwise, any message type other than CopyData or CopyDone may be treated as terminating copy-out mode.
  NotificationResponse: 0x41, // A
  NoticeResponse: 0x4e, // N
  ParameterStatus: 0x53, // S
}
