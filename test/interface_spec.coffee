describe 'Object interface', ->

  m = require('../src/')

  it 'should be an object',              -> expect(m).to.be.an('object')
  it 'should have "to" and "from" keys', -> expect(m).to.have.keys(['to', 'from'])
  it '"to" should be a function',        -> expect(m.to).to.be.a('function')
  it '"from" should be a function',      -> expect(m.from).to.be.a('function')
