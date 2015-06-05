chai             = require('chai')
global.expect    = chai.expect
global.getClient = require('./getClient.coffee')

chai.use require('sinon-chai')
