'use strict'

const CopyToQueryStream = require('./copy-to')
const CopyFromQueryStream = require('./copy-from')
const CopyBothQueryStream = require('./copy-both')

exports.to = function copyTo(txt, options) {
  return new CopyToQueryStream(txt, options)
}

exports.from = function copyFrom(txt, options) {
  return new CopyFromQueryStream(txt, options)
}

exports.both = function copyBoth(txt, options) {
  return new CopyBothQueryStream(txt, options)
}
