# http://www.postgresql.org/docs/current/static/protocol-message-formats.html

module.exports =
  error           : 69  # E Error
  copyOutResponse : 72  # H CopyOutResponse
  copyData        : 100 # d CopyData
  copyDone        : 99  # c CopyDone
  noticeResponse  : 78  # N NoticeResponse
  parameterStatus : 83  # S ParameterStatus
