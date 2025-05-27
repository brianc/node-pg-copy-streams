const { defineConfig } = require('eslint/config')

const prettier = require('eslint-plugin-prettier')
const globals = require('globals')
const js = require('@eslint/js')

const { FlatCompat } = require('@eslint/eslintrc')

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

module.exports = defineConfig([
  {
    plugins: {
      prettier,
    },

    extends: compat.extends('plugin:prettier/recommended'),

    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'module',
      parserOptions: {},

      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },

    rules: {
      'prefer-const': ['error'],
      'no-var': ['error'],

      'no-unused-vars': [
        'error',
        {
          args: 'none',
        },
      ],

      'prefer-destructuring': [
        'error',
        {
          array: false,
        },
      ],

      'no-useless-rename': ['error'],
    },
  },
])
