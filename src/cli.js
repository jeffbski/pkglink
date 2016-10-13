#!/usr/bin/env node
import 'node-sigint';  // enable SIGINT on windows
import chalk from 'chalk';
import fs from 'fs-extra-promise';
import Joi from 'joi';
import minimist from 'minimist';
import OS from 'os';
import Path from 'path';
import R from 'ramda';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import SingleLineLog from 'single-line-log';
import stripAnsi from 'strip-ansi';
import { formatBytes, sortObjKeys } from './util/format';
import { safeJsonReadSync, outputFileStderrSync } from './util/file';
import defaultRTEnv from './run-env-defaults';
import { prune, scanAndLink } from './index';

const isTTY = process.stdout.isTTY; // truthy if in terminal
const singleLineLog = SingleLineLog.stderr;

const DEFAULT_CONFIG_FILE = '.pkglink'; // in home directory
const DEFAULT_REFS_FILE = '.pkglink_refs'; // in home directory
const rtenv = { // create our copy
  ...defaultRTEnv
};

const minimistOpts = {
  boolean: ['d', 'g', 'h', 'p'],
  string: ['c', 'r'],
  alias: {
    c: 'config',
    d: 'dryrun',
    g: 'gen-ln-cmds',
    h: 'help',
    p: 'prune',
    r: 'refs-file',
    s: 'size',
    t: 'tree-depth'
  }
};
const argv = minimist(process.argv.slice(2), minimistOpts);

const argvSchema = Joi.object({
  config: Joi.string(),
  'refs-file': Joi.string(),
  size: Joi.number().integer().min(0),
  'tree-depth': Joi.number().integer().min(0)
})
.unknown();


const argvVResult = Joi.validate(argv, argvSchema);
if (argvVResult.error) {
  displayHelp();
  console.error('');
  console.error(chalk.red('error: invalid argument specified'));
  argvVResult.error.details.forEach(err => {
    console.error(err.message);
  });
  process.exit(20);
}

// should we be using terminal output
const isTermOut = isTTY && !argv['gen-ln-cmds'];

const CONFIG_PATH = argv.config ||
                    Path.resolve(process.env.HOME, DEFAULT_CONFIG_FILE);
const parsedConfigJson = safeJsonReadSync(CONFIG_PATH);
if (parsedConfigJson instanceof Error) {
  console.error(chalk.red('error: invalid JSON configuration'));
  console.error(`${chalk.bold('config file:')} ${CONFIG_PATH}`);
  console.error(parsedConfigJson); // error
  process.exit(21);
}
const unvalidatedConfig = parsedConfigJson || {};

const configSchema = Joi.object({
  refsFile: Joi.string().default(
    Path.resolve(process.env.HOME, DEFAULT_REFS_FILE)),
  concurrentOps: Joi.number().integer().min(1).default(4),
  minSize: Joi.number().integer().min(0).default(0),
  treeDepth: Joi.number().integer().min(0).default(0),
  refSize: Joi.number().integer().min(1).default(5),
  consoleWidth: Joi.number().integer().min(30).default(70)
});

const configResult = Joi.validate(unvalidatedConfig, configSchema, { abortEarly: false });
if (configResult.error) {
  console.error(chalk.red('error: invalid JSON configuration'));
  console.error(`${chalk.bold('config file:')} ${CONFIG_PATH}`);
  configResult.error.details.forEach(err => {
    console.error(err.message);
  });
  process.exit(22);
}
const config = configResult.value; // with defaults applied
R.toPairs({ // for these defined argv values override config
  dryrun: argv.dryrun,
  genLnCmds: argv['gen-ln-cmds'],
  minSize: argv.size,
  refsFile: argv['refs-file'],
  treeDepth: argv['tree-depth']
}).forEach(p => {
  const k = p[0];
  const v = p[1];
  if (!R.isNil(v)) { // if defined, use it
    config[k] = v;
  }
});
config.extraCols = config.consoleWidth - 30;

if (argv.help || (!argv._.length && !argv.prune)) { // display help
  displayHelp();
  process.exit(23);
}

function displayHelp() {
  outputFileStderrSync(Path.join(__dirname, '..', 'usage.txt'));
}

fs.ensureFileSync(config.refsFile);

const startingDirs = argv._.map(x => Path.resolve(x));

// key=nameVersion value: array of ref tuples [modPath, packJsonInode, packJsonMTimeEpoch]
rtenv.existingPackRefs = fs.readJsonSync(config.refsFile, { throws: false }) || {};


rtenv.cancelled$ = new ReplaySubject();

const singleLineLog$ = new Subject();
singleLineLog$
  .filter(x => isTermOut) // only if in terminal
  .distinct()
  .takeUntil(rtenv.cancelled$)
  .subscribe({
    next: x => singleLineLog(x),
    complete: () => {
      singleLineLog('');
      singleLineLog.clear();
    }
  });
const log = singleLineLog$.next.bind(singleLineLog$);
log.clear = () => {
  if (isTermOut) {
    singleLineLog('');
    singleLineLog.clear();
  }
};
rtenv.log = log; // share this logger in the rtenv

function out(str) {
  const s = (isTermOut) ? str : stripAnsi(str);
  process.stdout.write(s);
  process.stdout.write(OS.EOL);
}
rtenv.out = out; // share this output fn in the rtenv

const cancel = R.once(() => {
  rtenv.cancelled = true;
  rtenv.cancelled$.next(true);
  console.error('cancelling and saving state...');
});
const finalTasks = R.once(() => {
  singleLineLog$.complete();
  if (argv.dryrun || argv['gen-ln-cmds']) {
    out(`# ${chalk.yellow('would save:')} ${chalk.bold(formatBytes(rtenv.savedByteCount))}`);
    return;
  }
  if (argv.prune || Object.keys(rtenv.updatedPackRefs).length) {
    const sortedExistingPackRefs = sortObjKeys(
      R.merge(
        rtenv.existingPackRefs,
        rtenv.updatedPackRefs
      )
    );
    fs.outputJsonSync(config.refsFile, sortedExistingPackRefs);
    out(`updated ${config.refsFile}`);
  }
  if (rtenv.savedByteCount) {
    out(`${chalk.green('saved:')} ${chalk.bold(formatBytes(rtenv.savedByteCount))}`);
  }
});

process
  .once('SIGINT', cancel)
  .once('SIGTERM', cancel)
  .once('EXIT', finalTasks);

out(''); // advance to full line

// Main program start, create task$ and run
const arrTaskObs = [];
if (argv.prune) {
  arrTaskObs.push(
    Observable.of('pruning')
              .do(() => log(`${chalk.bold('pruning...')}`))
              .mergeMap(() => prune(config, rtenv.existingPackRefs)
                .do(newShares => { rtenv.existingPackRefs = newShares; }))
  );
}
if (startingDirs.length) {
  arrTaskObs.push(scanAndLink(config, rtenv, startingDirs));
}

// run all the task observables serially
if (arrTaskObs.length) {
  Observable.concat(...arrTaskObs)
            .subscribe({
              error: err => console.error(err),
              complete: () => finalTasks()
            });
}
