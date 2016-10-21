#!/bin/sh
':' //; export MAX_MEM="--max-old-space-size=2560"; exec "$(command -v node || command -v nodejs)" "${PKGLINK_NODE_OPTIONS:-$MAX_MEM}" "$0" "$@"

var OS = require('os');
var Path = require('path');
var minimist = require('minimist');
// managed sets up process listeners and win32 SIGINT hook
var managed = require('../build-lib/util/managed').default; // require in either case
var Constants = require('../build-lib/constants');
var FSUtils = require('../build-lib/util/file');

var script = Path.join(__dirname, '..', 'build-lib', 'cli.js');
var freeMemoryMB = Math.floor(OS.freemem() / (1024 * 1024));
var minimistOpts = {
  boolean: ['v'],
  string: ['c', 'm'],
  alias: {
      c: 'config',
      m: 'memory',
      v: 'verbose'
  }
};
var argv = minimist(process.argv.slice(2), minimistOpts);
var envNodeOptions = process.env.PKGLINK_NODE_OPTIONS;
var CONFIG_PATH = argv.config ||
                  Path.resolve(OS.homedir(), Constants.DEFAULT_CONFIG_FILE);
var parsedConfigJson = FSUtils.safeJsonReadSync(CONFIG_PATH);
var configMemory = parsedConfigJson && parsedConfigJson.memory;
var DESIRED_MEM = configMemory || 2560; // MB  - should match option in 2nd line
var hasExtraMemory = (DESIRED_MEM < freeMemoryMB);

// check in order argv.memory, env, config/default for node options
var nodeOptions = (argv.memory) ?
  ['--max-old-space-size=' + argv.memory] :
  (envNodeOptions) ?
    envNodeOptions.split(' ') :
    ['--max-old-space-size=' + DESIRED_MEM];

var options = {
  execArgv: process.execArgv.concat(nodeOptions)
};

if (argv.verbose) {
       console.log('argv.memory', argv.memory);
       console.log('process.env.PKGLINK_NODE_OPTIONS',
                   envNodeOptions);
       console.log('config', parsedConfigJson);
       console.log('freeMemoryMB', freeMemoryMB);
}

var noOverrideNotEnoughMemory =
  (!argv.memory &&
   !envNodeOptions &&
   !configMemory &&
   !hasExtraMemory);

var alreadyHasOptions = nodeOptions.every(
  o => process.execArgv.indexOf(o) !== -1
);

// no overrides and not enough extra memory or already has proper options
if (noOverrideNotEnoughMemory || alreadyHasOptions) {
  if (!alreadyHasOptions) { // indicate that we are running as is
    console.log('running with reduced memory, free:%sMB desired:%sMB', freeMemoryMB, DESIRED_MEM);
  }
  require(script); // already has options invoke directly
} else { // need to use child to get right options, most likely win32
  if (argv.verbose) {
    console.log('using child process to adjust working memory');
    console.log('execArgv:', options.execArgv);
  }
  managed(script, options);
}
