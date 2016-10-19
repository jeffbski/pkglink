#!/bin/sh
':' //; export MAX_MEM="--max-old-space-size=2048"; exec "$(command -v node || command -v nodejs)" "${NODE_OPTIONS:-$MAX_MEM}" "$0" "$@"

var Path = require('path');
var managed = require('../build-lib/util/managed').default; // require in either case

var script = Path.join(__dirname, '..', 'build-lib', 'cli.js');
var options = {
  execArgv: process.execArgv.concat(['--max-old-space-size=2048'])
};

if (process.execArgv.some(x => x === '--max-old-space-size=2048')) {
  console.log('requiring directly');
  require(script); // already has options invoke directly
} else { // need to use child to get right options
  console.log('using child proc');
  managed(script, options);
}
