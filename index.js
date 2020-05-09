'use strict'

const CopyToQueryStream = require('./copy-to')
const CopyFromQueryStream = require('./copy-from')
module.exports = {
  to: function (txt, options) {
    return new CopyToQueryStream(txt, options)
  },
  from: function (txt, options) {
    return new CopyFromQueryStream(txt, options)
  },
}
