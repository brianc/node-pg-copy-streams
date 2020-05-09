module.exports = {
  plugins: ['prettier'],
  extends: ['plugin:prettier/recommended'],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  env: {
    node: true,
    es6: true,
    mocha: true,
  },
  rules: {
    'prefer-const': ['error'],
    'no-var': ['error'],
    'no-unused-vars': ['error', { args: 'none' }],
    'prefer-destructuring': ['error', { array: false }],
    'no-useless-rename': ['error'],
  },
}
