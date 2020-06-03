'use strict'

const CopyToQueryStream = require('./copy-to')
const CopyFromQueryStream = require('./copy-from')
const CopyBothQueryStream = require('./copy-both')
module.exports = {
  to: function (txt, options) {
    return new CopyToQueryStream(txt, options)
  },
  from: function (txt, options) {
    return new CopyFromQueryStream(txt, options)
  },
  both: function (txt, options) {
    return new CopyBothQueryStream(txt, options)
  },
}
