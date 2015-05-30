var CopyToQueryStream   = require('./copyTo');
var CopyFromQueryStream = require('./copyFrom');

module.exports = {
  to: function(txt, options) {
    return new CopyToQueryStream(txt, options);
  },
  from: function (txt, options) {
    return new CopyFromQueryStream(txt, options);
  }
};
