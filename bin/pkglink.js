#!/bin/sh
':' //; export MAX_MEM="--max-old-space-size=2560"; exec "$(command -v node || command -v nodejs)" "${NODE_OPTIONS:-$MAX_MEM}" "$0" "$@"

var OS = require('os');
var Path = require('path');
var minimist  = require('minimist');
// managed sets up process listeners and win32 SIGINT hook
var managed = require('../build-lib/util/managed').default; // require in either case
var Constants = require('../build-lib/constants');
var FSUtils = require('../build-lib/util/file');

var script = Path.join(__dirname, '..', 'build-lib', 'cli.js');
var freeMemoryMB = Math.floor(OS.freemem() / (1024 * 1024));
var minimistOpts = {
  string: ['c'],
  alias: {
    c: 'config'
  }
};
var argv = minimist(process.argv.slice(2), minimistOpts);
var CONFIG_PATH = argv.config ||
                  Path.resolve(OS.homedir(), Constants.DEFAULT_CONFIG_FILE);
var parsedConfigJson = FSUtils.safeJsonReadSync(CONFIG_PATH);
var DESIRED_MEM = (parsedConfigJson && parsedConfigJson.memory) ?
                  parsedConfigJson.memory :
                  2560; // MB  - should match option in 2nd line
var hasExtraMemory = (DESIRED_MEM < freeMemoryMB);
var memoryArg = '--max-old-space-size=' + DESIRED_MEM;
var options = {
  execArgv: process.execArgv.concat([memoryArg])
};

if (!hasExtraMemory) {
  console.log('running with reduced memory, free:%sMB desired:%sMB', freeMemoryMB, DESIRED_MEM);
}

// not enough extra memory or already has proper option
if (!hasExtraMemory || process.execArgv.some(x => x === memoryArg)) {
  require(script); // already has options invoke directly
} else { // need to use child to get right options, most likely win32
  console.log('using child process for increased working memory');
  managed(script, options);
}
