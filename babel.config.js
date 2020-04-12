const BABEL_ENV = process.env.BABEL_ENV;
const CI = process.env.CI && process.env.CI === 'true';

const presets = [
  [
    '@babel/env',
    {
      // targets are specified in .browserslist
      // run `npx browserslist` will show resultant targets or see debug output from build
      useBuiltIns: 'usage',
      corejs: '3.6.4',
      modules: BABEL_ENV === 'es' ? false : 'auto', // not transforming modules for es
      debug: CI // show the browser target and plugins used when in CI mode
    }
  ]
];

const plugins = [];

// these are merged with others
const env = {};

module.exports = {
  env,
  plugins,
  presets
};
