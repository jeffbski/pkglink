#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra-promise';
import numeral from 'numeral';
import OS from 'os';
import Path from 'path';
import R from 'ramda';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import SingleLineLog from 'single-line-log';
import stripAnsi from 'strip-ansi';
import { formatBytes, sortObjKeys } from './util/format';
import { outputFileStderrSync } from './util/file';
import defaultRTEnv from './run-env-defaults';
import { prune, scanAndLink } from './index';
import managed from './util/managed';
import { gatherOptionsConfig } from './cli-options';

const isTTY = process.stdout.isTTY; // truthy if in terminal
const singleLineLog = SingleLineLog.stderr;

const rtenv = { // create our copy
  ...defaultRTEnv
};

const { argv, config } = gatherOptionsConfig(process.argv.slice(2),
                                             displayHelp);

// should we be using terminal output
const isTermOut = isTTY && !argv['gen-ln-cmds'];

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


rtenv.cancelled$ = new ReplaySubject(1);

const singleLineLog$ = new Subject();
singleLineLog$
  .filter(x => isTermOut) // only if in terminal
  .distinctUntilChanged()
  .throttleTime(100)
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
  console.error('cancelling...');
});
const finalTasks = R.once(() => {
  singleLineLog$.complete();
  if (argv.dryrun || argv['gen-ln-cmds']) {
    out(`# ${chalk.blue('pkgs:')} ${numeral(rtenv.packageCount).format('0,0')} ${chalk.yellow('would save:')} ${chalk.bold(formatBytes(rtenv.savedByteCount))}`);
    managed.shutdown();
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
    if (argv.prune) { out(`updated ${config.refsFile}`); }
  }
  out(`${chalk.blue('pkgs:')} ${numeral(rtenv.packageCount).format('0,0')} ${chalk.green('saved:')} ${chalk.bold(formatBytes(rtenv.savedByteCount))}`);
  managed.shutdown();
});

managed.onInterrupt(cancel); // fires on SIGINT
process
  .once('SIGTERM', cancel)
  .once('EXIT', finalTasks);

if (argv.verbose) {
  console.log('argv', argv);
  console.log('config', config);
}

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
  arrTaskObs.push(
    Observable.of('scanning')
      .mergeMap(() => scanAndLink(config, rtenv, startingDirs))
  );
}

// run all the task observables serially
if (arrTaskObs.length) {
  Observable.concat(...arrTaskObs)
            .subscribe({
              error: err => console.error(err),
              complete: () => finalTasks()
            });
}
