# http://www.postgresql.org/docs/current/static/protocol-message-formats.html
#
# This list only includes the codes we expect to get.
#
module.exports =
  error           : 'E'
  copyOutResponse : 'H'
  copyData        : 'd'
  copyDone        : 'c'
  close           : 'C'
  noticeResponse  : 'N'
  parameterStatus : 'S'
  readyForQuery   : 'Z'
