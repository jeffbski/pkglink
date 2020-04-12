module.exports = {
  env: {
    mocha: true,
    node: true
  },
  extends: ['standard', 'prettier', 'prettier/standard'],
  rules: {
    camelcase: 'off',
    'handle-callback-err': 'off'
  },
  parser: 'babel-eslint'
};
