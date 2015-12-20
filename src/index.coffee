CopyToQueryStream   = require('./copyTo')
CopyFromQueryStream = require('./copyFrom')

module.exports =
  to: (t,o) -> new CopyToQueryStream t,o

  from: (t,o) -> new CopyFromQueryStream t,o
