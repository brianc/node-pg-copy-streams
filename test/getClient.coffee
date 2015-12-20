pg = require('pg')

module.exports = ->
  client = new pg.Client()
  client.connect()
  return client
