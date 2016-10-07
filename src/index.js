require('node-sigint');  // enable SIGINT on windows
const chalk = require('chalk');
const fs = require('fs-extra-promise');
const hideCursor = require('hide-terminal-cursor');
const Joi = require('joi');
const minimist = require('minimist');
const numeral = require('numeral');
const OS = require('os');
const Path = require('path');
const R = require('ramda');
const readdirp = require('readdirp');
const Rx = require('rxjs');
const showCursor = require('show-terminal-cursor');
const singleLineLog = require('single-line-log').stdout;
const stripAnsi = require('strip-ansi');
const T = require('timm');
const truncate = require('cli-truncate');

const Observable = Rx.Observable;

const isTTY = process.stdout.isTTY; // truthy if in terminal

const DEFAULT_CONFIG_FILE = '.pkglink'; // in home directory
const DEFAULT_REFS_FILE = '.pkglink_refs'; // in home directory

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
  minSize: argv.size,
  treeDepth: argv['tree-depth']
}).forEach(p => {
  const k = p[0];
  const v = p[1];
  if (!R.isNil(v)) { // if defined, use it
    config[k] = v;
  }
});

const REFS_PATH = Path.resolve(argv['refs-file'] || config.refsFile);
const CONC_OPS = config.concurrentOps; // concurrent operations in mergeMap, default 4
const MIN_SIZE = config.minSize; // minimum size before sharing, default 0
const TREE_DEPTH = config.treeDepth; // depth to find mods, def 0 unlim
const EXTRACOLS = config.consoleWidth - 20;

if (argv.help || (!argv._.length && !argv.prune)) { // display help
  displayHelp();
  process.exit(23);
}

function displayHelp() {
  const help = fs.readFileSync(Path.join(__dirname, '..', 'usage.txt'));
  process.stderr.write(help);
}

fs.ensureFileSync(REFS_PATH);

const startingDirs = argv._.map(x => Path.resolve(x));

// key=nameVersion value: array of ref tuples [modPath, packJsonInode, packJsonMTimeEpoch]
let existingShares = fs.readJsonSync(REFS_PATH, { throws: false }) || {};
const origExistingShares = existingShares; // keep ref copy

let packageCount = 0;
let savedByteCount = 0;
let completedModules = 0;

const ENDS_NODE_MOD_RE = /[\\\/]node_modules$/;

let cancelled = false;
const cancelled$ = new Rx.ReplaySubject();

const singleLineLog$ = new Rx.Subject();
singleLineLog$
  .filter(x => isTermOut) // only if in terminal
  .distinct()
  .throttleTime(10)
  .takeUntil(cancelled$)
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
function out(str) {
  const s = (isTermOut) ? str : stripAnsi(str);
  process.stdout.write(s);
  process.stdout.write(OS.EOL);
}

const cancel = R.once(() => {
  cancelled = true;
  cancelled$.next(true);
  console.error('cancelling and saving state...');
  if (isTermOut) { showCursor(); }
});
const finalTasks = R.once(() => {
  singleLineLog$.complete();
  if (isTermOut) { showCursor(); }
  if (argv.dryrun || argv['gen-ln-cmds']) {
    out(`# ${chalk.yellow('would save:')} ${chalk.bold(formatBytes(savedByteCount))}`);
    return;
  }
  if (existingShares !== origExistingShares) {
    const sortedExistingShares = sortObjKeys(existingShares);
    fs.outputJsonSync(REFS_PATH, sortedExistingShares);
    out(`updated ${REFS_PATH}`);
  }
  if (savedByteCount) {
    out(`${chalk.green('saved:')} ${chalk.bold(formatBytes(savedByteCount))}`);
  }
});

process
  .once('SIGINT', cancel)
  .once('SIGTERM', cancel)
  .once('EXIT', finalTasks);

if (isTermOut) { hideCursor(); } // show on exit
out(''); // advance to full line

// Main program start, create task$ and run
const arrTaskObs = [];
if (argv.prune) {
  arrTaskObs.push(
    Observable.of('pruning')
              .do(() => log(`${chalk.bold('pruning...')}`))
              .mergeMap(() => prune(existingShares)
                .do(newShares => { existingShares = newShares; }))
  );
}
if (startingDirs.length) {
  arrTaskObs.push(scanAndLink(startingDirs, argv));
}

// run all the task observables serially
if (arrTaskObs.length) {
  Observable.concat(...arrTaskObs)
            .subscribe({
              error: err => console.error(err),
              complete: () => finalTasks()
            });
}

function prune(dnvMR) { // return obs of new dnvMR object
  return Observable.from(
    R.toPairs(dnvMR) // [dnv, arrModRefs]
  )
  .mergeMap(dnv_MR => verifyDMR(dnv_MR), CONC_OPS)
  .reduce((acc, dnv_MR) => R.append(dnv_MR, acc),
          [])
  .map(flatDMR => R.fromPairs(flatDMR));
}

function verifyDMR([dnv, arrModRefs]) {  // return obs of valid dnv_MR
  return Observable.from(arrModRefs) // obs of modRefs
  // returns obs of valid modRef
                   .mergeMap(modRef => verifyModRef(dnv, modRef, false),
                             CONC_OPS)
                   .reduce((acc, modRef) => R.append(modRef, acc),
                           [])
                   .map(arrRefEI => [dnv, arrRefEI]); // dnv_MR
}

function verifyModRef(dnv, modRef, returnEI = false) { // return obs of valid modRef
  const modDir = modRef[0];
  const packInode = modRef[1];
  const packMTimeEpoch = modRef[2];
  const packPath = Path.join(modDir, 'package.json');
  let packStat;
  return Observable.from(fs.statAsync(packPath)
    .then(stat => { // eslint-disable-line consistent-return
      if (stat &&
          stat.ino === packInode &&
          stat.mtime.getTime() === packMTimeEpoch) {
        packStat = stat; // save for later use
        return fs.readJsonAsync(packPath, { throws: false });
      }
    })
    // if json and matches, return modRef or EI
    .then(json => { // eslint-disable-line consistent-return
      if (json) {
        const devNameVer = formatDevNameVersion(packStat.dev, json.name, json.version);
        if (devNameVer === dnv) {
          return (returnEI) ?
                 { // masterEI
                   stat: packStat,
                   fullParentDir: modDir
                 } :
                 modRef;
        }
      }
    })
    .catch(err => {
      if (err.code !== 'ENOENT') {
        console.error(err);
      }
    })
  )
  .filter(x => x); // filter any undefineds, those were invalid
}

const logOnceChecking = R.once(() => {
  log('checking for new links...');
});

function filterDirsNodeModPacks(ei) {
  const eiName = ei.name;
  if (eiName.charAt(0) === '.') { return false; } // no dot dirs
  if (eiName === 'node_modules') { return true; } // node_modules
  const eiFullParentDir = ei.fullParentDir;
  if (eiFullParentDir.indexOf('node_modules') !== -1) { // under node_modules
    // only if grand parent is node_modules will we continue down
    return (Path.basename(eiFullParentDir) === 'node_modules');
  }
  return true; // not in node_modules yet, so keep walking
}

function scanAndLink(rootDirs, options) {
  return Observable.from(rootDirs)
          // find all package.json files
          .mergeMap(
            startDir => {
              const readdirpOptions = {
                root: startDir,
                entryType: 'files',
                lstat: true,  // want actual files not symlinked
                fileFilter: ['package.json'],
                directoryFilter: filterDirsNodeModPacks
              };
              if (TREE_DEPTH) { readdirpOptions.depth = TREE_DEPTH; }
              const fstream = readdirp(readdirpOptions);
              cancelled$.subscribe(() => fstream.destroy()); // stop reading
              return Observable.fromEvent(fstream, 'data')
                               .takeWhile(() => !cancelled)
                               .takeUntil(Observable.fromEvent(fstream, 'close'))
                               .takeUntil(Observable.fromEvent(fstream, 'end'));
            },
            CONC_OPS
          )
          // only parents ending in node_modules
          .filter(ei => ENDS_NODE_MOD_RE.test(Path.dirname(ei.fullParentDir))
          )
          // get name and version from package.json
          .mergeMap(
            ei => Observable.from(fs.readJsonAsync(ei.fullPath, { throws: false })),
            (ei, pack) => ({ // returns eiDN
              entryInfo: ei,
              devNameVer: (pack && pack.name && pack.version) ?
                          formatDevNameVersion(ei.stat.dev, pack.name, pack.version) :
                          null
            }),
            CONC_OPS
          )
          .filter(obj => obj.devNameVer) // has name and version, not null
          .do(obj => { packageCount += 1; })
          .do(obj => log(`${chalk.blue('pkgs:')} ${numeral(packageCount).format('0,0')} ${chalk.bold('scanning:')} ${chalk.dim(trunc(obj.entryInfo.fullParentDir))}`))
          .groupBy(eiDN => eiDN.devNameVer)
          .mergeMap(group => {
            return group.reduce((acc, eiDN) => {
              acc.push(eiDN.entryInfo);
              return acc;
            }, [])
            .map(arrEI => [group.key, arrEI]); // [devNameVer, arrPackEI]
          })
          .do(dnv_packEIs => { // if dryrun, output the module and shared paths
            if (options.dryrun) {
              log.clear();
              const [dnv, packEIs] = dnv_packEIs;
              if (cancelled) { return; }
              out(chalk.bold(dnv.split(':')[1])); // nameVersion
              packEIs.forEach(pEI => out(`  ${pEI.fullParentDir}`));
              out('');
            }
          })
          .takeWhile(() => !cancelled)
          .do(() => { logOnceChecking(); })
          .mergeMap(
            dnv_p => determineModLinkSrcDst(dnv_p),
            CONC_OPS
          )
          .takeWhile(() => !cancelled)
          .mergeMap(
            lnkSrcDst => {
              if (options.dryrun) {
                return determineLinks(lnkSrcDst, false);
              } else if (options['gen-ln-cmds']) {
                return genModuleLinks(lnkSrcDst);
              }
              return handleModuleLinking(lnkSrcDst);
            },
            CONC_OPS
          )
          .scan(
            (acc, x) => {
              acc += x.srcEI.stat.size;
              return acc;
            },
            0
          )
          .do(savedBytes => { savedByteCount = savedBytes; })
          .do(savedBytes => {
            const verb = (options.dryrun) ? 'checking:' : 'linking:';
            const saved = (options.dryrun) ? 'would save:' : 'saved:';
            log(`${chalk.bold(verb)} ${calcPerc(completedModules, packageCount)}% ${chalk.green(saved)} ${chalk.bold(formatBytes(savedBytes))}`);
          });
}

function formatDevNameVersion(dev, name, version) {
  return `${dev}:${name}-${version}`;
}

function formatBytes(bytes) {
  return numeral(bytes).format('0.[00]b');
}

function calcPerc(top, bottom) {
  if (top === 0) { return 0; }
  if (bottom === 0) { return 0; }
  let perc = Math.floor((top * 100) / bottom);
  if (perc < 0) perc = 0;
  if (perc > 100) perc = 100;
  return perc;
}

function sortObjKeys(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
}


function determineModLinkSrcDst([dnv, arrPackEI]) { // ret obs of srcDstObj
  if (cancelled) { return Observable.never(); }

  return findExistingMaster(dnv, arrPackEI)
    // if no master found, then use first in arrPackEI
    .map(masterEI => masterEI || arrPackEI[0])
    .takeWhile(() => !cancelled)
    .mergeMap(masterEI =>
      // use asap scheduler to prevent stack from being exceeded
      Observable.from(arrPackEI, Rx.Scheduler.asap)
                .takeWhile(() => !cancelled)
                .filter(dstEI => !isEISameInode(masterEI, dstEI))
                .map(dstEI => ({
                  devNameVer: dnv, // device:nameVersion
                  src: masterEI.fullParentDir,
                  srcPackInode: masterEI.stat.ino,
                  srcPackMTimeEpoch: masterEI.stat.mtime.getTime(),
                  dst: dstEI.fullParentDir,
                  dstPackInode: dstEI.stat.ino,
                  dstPackMTimeEpoch: dstEI.stat.mtime.getTime()
                })),
      CONC_OPS
    );
}

function findExistingMaster(dnv, arrPackEI) { // returns Obs of masterEI_modRefs (or none)
  /*
     we will be checking through the existingShares[dnv] modRefs
     to see if any are still valid. Resolve with the first one that is
     still valid, also returning the remaining modRefs. Not all of the
     modRefs will have been checked, just enough to find one valid one.
     Updates existingShares to new object with updated modRefs if
     any were invalid.
     Use prune to go through and clean out all invalid ones.
     Resolves with masterEI or uses first from arrPackEI
   */

  // check existingShares[dnv] for ref tuples
  const masterModRefs = R.pathOr([], [dnv], existingShares); // array of [modDir, packInode, packMTimeEpoch] modRef tuples

  return Observable.from(masterModRefs)
                   .mergeMap(
                     modRef => verifyModRef(dnv, modRef, true),
                     1 // one at a time since only need first
                   )
                   .first(
                     masterEI => masterEI, // exists
                     (masterEI, idx) => [masterEI, idx],
                     null
                   )
                   .map(masterEI_idx => {
                     if (!masterEI_idx) {
                       // no valid found, use arrPackEI[0]
                       const packEI = arrPackEI[0];
                       existingShares = T.setIn(
                         existingShares,
                         [dnv],
                         [buildModRef(packEI.fullParentDir,
                                     packEI.stat.ino,
                                     packEI.stat.mtime.getTime())]
                       );
                       return packEI;
                     } else if (masterEI_idx[1] !== 0) {
                       const idx = masterEI_idx[1];
                       // wasn't first one so needs slicing
                       existingShares = T.setIn(
                         existingShares,
                         [dnv],
                         masterModRefs.slice(idx)
                       );
                     }
                     return masterEI_idx[0];
                   });
}

function isEISameInode(firstEI, secondEI) {
  return ((firstEI.stat.dev === secondEI.stat.dev) &&
          (firstEI.stat.ino === secondEI.stat.ino));
}

function buildModRef(modFullPath, packageJsonInode, packageJsonMTimeEpoch) {
  return [
    modFullPath,
    packageJsonInode,
    packageJsonMTimeEpoch
  ];
}

function genModuleLinks(lnkModSrcDst) { // returns observable
  return determineLinks(lnkModSrcDst, true)
    // just output the ln commands
    .do(fileSrcAndDstEIs => {
      const srcEI = fileSrcAndDstEIs.srcEI;
      const dstEI = fileSrcAndDstEIs.dstEI;
      out(`ln -f "${srcEI.fullPath}" "${dstEI.fullPath}"`);
    });
}

function handleModuleLinking(lnkModSrcDst) { // returns observable
  return determineLinks(lnkModSrcDst, true)
    .mergeMap(
      fileSrcAndDstEIs => performLink(fileSrcAndDstEIs),
      (fileSrcAndDstEIs, ops) => fileSrcAndDstEIs,
      CONC_OPS
    );
}

function determineLinks(lnkModSrcDst, updateExistingShares = false) { // returns observable of fileSrcAndDstEIs
  // src is the master we link from, dst is the dst link
  const devNameVer = lnkModSrcDst.devNameVer; // device:nameVersion
  const srcRoot = lnkModSrcDst.src;
  const srcPackInode = lnkModSrcDst.srcPackInode;
  const srcPackMTimeEpoch = lnkModSrcDst.srcPackMTimeEpoch;
  const dstRoot = lnkModSrcDst.dst;
  const dstPackInode = lnkModSrcDst.dstPackInode;
  const dstPackMTimeEpoch = lnkModSrcDst.dstPackMTimeEpoch;

  if (updateExistingShares) {
    const arrWithSrcModRef = [buildModRef(srcRoot, srcPackInode, srcPackMTimeEpoch)];
    const dstModRef = buildModRef(dstRoot, dstPackInode, dstPackMTimeEpoch);
    existingShares =
      R.over(R.lensPath([devNameVer]),
             // if modRefs is undefined or empty, set to master
             // then append dst after filtering any previous entry
             R.pipe(
               R.defaultTo(arrWithSrcModRef),
               R.when(R.propEq('length', 0), R.always(arrWithSrcModRef)),
               R.filter(modRef => modRef[0] !== dstRoot),
               R.append(dstModRef)),
             existingShares);
  }

  const fstream = readdirp({
    root: lnkModSrcDst.src,
    entryType: 'files',
    lstat: true,  // want actual files not symlinked
    fileFilter: ['!.*'],
    directoryFilter: ['!.*', '!node_modules']
  });
  fstream.once('end', () => { completedModules += 1; });
  cancelled$.subscribe(() => fstream.destroy()); // stop reading

  return Observable.fromEvent(fstream, 'data')
                   .takeWhile(() => !cancelled)
                   .takeUntil(Observable.fromEvent(fstream, 'close'))
                   .takeUntil(Observable.fromEvent(fstream, 'end'))
                   // combine with stat for dst
                   .mergeMap(
                     srcEI => {
                       const dstPath = Path.resolve(dstRoot, srcEI.path);
                       return Observable.from(
                         fs.statAsync(dstPath)
                           .then(stat => ({
                             fullPath: dstPath,
                             stat
                           }))
                           .catch(err => {
                             if (err.code !== 'ENOENT') {
                               console.error(err);
                             }
                             return null;
                           })
                       );
                     },
                     (srcEI, dstEI) => ({
                       srcEI,
                       dstEI
                     }),
                     CONC_OPS
                   )
                   .filter(x =>
                     // filter out missing targets
                     ((x.dstEI) &&
                      // take only non-package.json, existingShares uses
                      (x.dstEI.stat.ino !== dstPackInode) &&
                      // big enough to care about
                      (x.dstEI.stat.size >= MIN_SIZE) &&
                      // make sure not same inode as master
                      (x.srcEI.stat.ino !== x.dstEI.stat.ino) &&
                      // same device
                      (x.srcEI.stat.dev === x.dstEI.stat.dev) &&
                      // same size
                      (x.srcEI.stat.size === x.dstEI.stat.size) &&
                      // same modified datetime
                      (x.srcEI.stat.mtime.getTime() ===
                        x.dstEI.stat.mtime.getTime())
                     )
                   );
}

function performLink(srcAndDstEIs) {  // returns observable
  const srcEI = srcAndDstEIs.srcEI;
  const dstEI = srcAndDstEIs.dstEI;
  return Observable.from(
    fs.unlinkAsync(dstEI.fullPath)
      .then(() => fs.linkAsync(srcEI.fullPath,
                               dstEI.fullPath))
      .catch(err => {
        console.error(`failed to unlink/link src:${srcEI.fullPath} dst:${dstEI.fullPath}`, err);
        throw err;
      })
  );
}

function trunc(str) {
  return truncate(str, EXTRACOLS, { position: 'middle' });
}

function safeJsonReadSync(file) { // returns obj, error, or undefined when not found
  try {
    const stat = fs.statSync(file);
    if (stat && stat.size) {
      try {
        return fs.readJsonSync(file);
      } catch (err) {
        return err;
      }
    }
    return undefined;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(err);
      return err;
    }
    return undefined;
  }
}
