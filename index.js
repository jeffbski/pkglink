require('node-sigint');  // enable SIGINT on windows
const chalk = require('chalk');
const fs = require('fs-extra-promise');
const hideCursor = require('hide-terminal-cursor');
const Joi = require('joi');
const minimist = require('minimist');
const numeral = require('numeral');
const once = require('once');
const Path = require('path');
const R = require('ramda');
const readdirp = require('readdirp');
const Rx = require('rxjs');
const showCursor = require('show-terminal-cursor');
const singleLineLog = require('single-line-log').stdout;
const T = require('timm');
const truncate = require('cli-truncate');

const Observable = Rx.Observable;

const minimistOpts = {
  boolean: ['d', 'h', 'p'],
  string: ['c', 'r'],
  alias: {
    c: 'config',
    d: 'dryrun',
    h: 'help',
    p: 'prune',
    r: 'refs-file',
    s: 'size',
    t: 'tree-depth',
    u: 'uses'
  }
};
const argv = minimist(process.argv.slice(2), minimistOpts);

const argvSchema = Joi.object({
  config: Joi.string(),
  'refs-file': Joi.string(),
  size: Joi.number().integer().min(0),
  'tree-depth': Joi.number().integer().min(1),
  uses: Joi.number().integer().min(2)
}).unknown();

const argvVResult = Joi.validate(argv, argvSchema);
if (argvVResult.error) {
  displayHelp();
  console.error('');
  console.error(chalk.red('error: invalid argument specified'));
  argvVResult.error.details.forEach(err => {
    console.error(err.message);
  });
  process.exitCode = 20;
  return;
}

const CONFIG_PATH = argv.config || Path.resolve(process.env.HOME, '.modshare');
const parsedConfigJson =  safeJsonReadSync(CONFIG_PATH);
if (parsedConfigJson instanceof Error) {
  console.error(chalk.red('error: invalid JSON configuration'));
  console.error(`${chalk.bold('config file:')} ${CONFIG_PATH}`);
  console.error(parsedConfigJson); // error
  process.exitCode = 21;
  return;
}
const unvalidatedConfig = parsedConfigJson || {};

const configSchema = Joi.object({
  refsFile: Joi.string().default(Path.resolve(process.env.HOME, '.modshare_refs.json')),
  concurrentOps: Joi.number().integer().min(1).default(4),
  minUses: Joi.number().integer().min(2).default(2),
  minSize: Joi.number().integer().min(0).default(0),
  treeDepth: Joi.number().integer().min(1).default(6),
  consoleWidth: Joi.number().integer().min(30).default(70)
});

const configResult = Joi.validate(unvalidatedConfig, configSchema, { abortEarly: false });
if (configResult.error) {
  console.error(chalk.red('error: invalid JSON configuration'));
  console.error(`${chalk.bold('config file:')} ${CONFIG_PATH}`);
  configResult.error.details.forEach(err => {
    console.error(err.message);
  });
  process.exitCode = 22;
  return;
}
const config = configResult.value; // with defaults applied

const REFS_PATH = Path.resolve(argv['refs-file'] || config.refsFile);
const CONC_OPS = config.concurrentOps; // concurrent operations in mergeMap, default 4
const MIN_USES = argv.uses || config.minUses; // minimum uses before sharing, default 2
const MIN_SIZE = argv.size || config.minSize; // minimum size before sharing, default 0
const TREE_DEPTH = argv['tree-depth'] || config.treeDepth; // depth to find modules, default 6
const EXTRACOLS = config.consoleWidth - 20;

let phase = 'init'; // init | check | link

if (argv.help || (!argv._.length && !argv.prune)) { // display help
  displayHelp();
  process.exitCode = 23;
  return;
}

function displayHelp() {
  const help = fs.readFileSync(Path.join(__dirname, 'usage.txt'));
  process.stderr.write(help);
}

fs.ensureFileSync(REFS_PATH);

const startingDirs = argv._.map(x => Path.resolve(x));

// key=nameVersion value: array of ref tuples [modPath, packJsonInode, packJsonMTimeEpoch]
let existingShares = fs.readJsonSync(REFS_PATH, { throws: false }) || {};
const origExistingShares = existingShares; // keep ref copy

let packageCount = 0;
let savedByteCount = 0;
let commonModules = 0;
let completedModules = 0;

const ENDS_NODE_MOD_RE = /[\\\/]node_modules$/;

let cancelled = false;
const cancelled$ = new Rx.Subject();

const singleLineLog$ = new Rx.Subject()
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
  singleLineLog('');
  singleLineLog.clear();
}

const cancel = once(() => {
  cancelled = true;
  cancelled$.next(true);
  console.error('cancelling and saving state...');
  showCursor();
});
const finalTasks = once(() => {
  singleLineLog$.complete();
  showCursor();
  if (argv.dryrun) {
    console.log(`${chalk.yellow('would save:')} ${chalk.bold(formatBytes(savedByteCount))}`);
    return;
  }
  if (existingShares !== origExistingShares) {
    const sortedExistingShares = sortObjKeys(existingShares);
    fs.outputJsonSync(REFS_PATH, sortedExistingShares);
    console.log(`updated ${REFS_PATH}`);
  }
  if (savedByteCount) {
    console.log(`${chalk.green('saved:')} ${chalk.bold(formatBytes(savedByteCount))}`);
  }
});

process
  .once('SIGINT', cancel)
  .once('SIGTERM', cancel)
  .once('EXIT', finalTasks);

hideCursor(); // show on exit
console.log(''); // advance to full line

// Main program start, create task$ and run
const arrTaskObs = [];
if (argv.prune) {
  arrTaskObs.push(
    Observable.of('pruning')
              .do(() => log(`${chalk.bold('pruning...')}`))
              .mergeMap(() => prune(existingShares)
                .do(newShares => existingShares = newShares))
  );
}
if (startingDirs.length) {
  arrTaskObs.push(scanAndLink(startingDirs, argv));
}

// run all the task observables serially
if (arrTaskObs.length) {
  Observable.concat.apply(Observable, arrTaskObs)
            .subscribe({
              error: err => console.error(err),
              complete: () => finalTasks()
            });
}

function prune(dmr) { // return obs of newDMRObj
  return Observable.from(
    flattenObj2Levels(dmr) // [[d, m, r]]
  )
  .mergeMap(d_m_r => verifyDMR(d_m_r), CONC_OPS)
  .reduce((acc, d_m_r) => R.append(d_m_r, acc),
          [])
  .map(flatDMR => rebuild2LevelObj(flatDMR));
}

function verifyDMR(d_m_r) {  // return obs of valid d_m_r
  const mod = d_m_r[1];
  return Observable.from(d_m_r[2]) // obs of modRefs
  // returns obs of valid modRef
                   .mergeMap(modRef => verifyModRef(mod, modRef, false),
                             CONC_OPS)
                   .reduce((acc, modRef) => R.append(modRef, acc),
                           [])
                   .map(arrRefEI => [d_m_r[0], d_m_r[1], arrRefEI]);
}

function verifyModRef(mod, modRef, returnEI = false) { // return obs of valid modRef
  const modDir = modRef[0];
  const packInode = modRef[1];
  const packMTimeEpoch = modRef[2];
  const packPath = Path.join(modDir, 'package.json');
  let packStat;
  return Observable.from(fs.statAsync(packPath)
    .then(stat => {
      if (stat &&
          stat.ino === packInode &&
          stat.mtime.getTime() === packMTimeEpoch) {
        packStat = stat; // save for later use
        return fs.readJsonAsync(packPath, { throws: false });
      }
    })
    .then(json => { // if json and matches, return modRef or EI
      if (json) {
        const nameVersion = formatModNameVersion(json.name, json.version);
        if (nameVersion === mod) {
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


function scanAndLink(rootDirs, options) {
  return Observable.from(rootDirs)
          // find all package.json files
          .mergeMap(
            startDir => {
              const fstream = readdirp({
                root: startDir,
                entryType: 'files',
                fileFilter: ['package.json'],
                directoryFilter: ['!.*'],
                depth: TREE_DEPTH
              });
              return Observable.fromEvent(fstream, 'data')
                               .takeUntil(cancelled$)
                               .takeUntil(Observable.fromEvent(fstream, 'end'))
                               // only fullPaths under the rootDir, not symlinked
                               .filter(ei => ei.fullParentDir.startsWith(startDir))
            },
            CONC_OPS
          )
          // only parents ending in node_modules
          .filter(ei => ENDS_NODE_MOD_RE.test(Path.dirname(ei.fullParentDir))
          )
          // get name and version from package.json
          .mergeMap(
            ei => Observable.from(fs.readJsonAsync(ei.fullPath, { throws: false })),
            (ei, pack) => ({
              entryInfo: ei,
              nameVersion: (pack && pack.name && pack.version) ?
                           formatModNameVersion(pack.name, pack.version) :
                           null
            }),
            CONC_OPS
          )
          .filter(obj => obj.nameVersion) // has name and version, not null
          .do(obj => packageCount += 1)
          .do(obj => log(`${chalk.blue('pkgs:')} ${numeral(packageCount).format('0,0')} ${chalk.bold('scanning:')} ${chalk.dim(trunc(obj.entryInfo.fullParentDir))}`))
          .reduce((acc, obj) => { // reduce into allPendingMap { DEV: { nameVersion: arrayPackEI } }
            const dev = obj.entryInfo.stat.dev;
            if (!acc[dev]) { acc[dev] = {}; } // separate maps by device id
            const paths = acc[dev][obj.nameVersion] || [];
            acc[dev][obj.nameVersion] = paths.concat(obj.entryInfo);
            return acc;
          }, {})
          .do(allPendingMap => phase = 'check')
          .do(allPendingMap => log(`${chalk.bold('checking for shared modules...')}`))
          // transform  allPendingMap to [[dev, mod, arrPackEIs]]
          // filter by MIN_USES
          .map(allPendingMap =>
            flattenObj2Levels(allPendingMap)
              .filter(dmp => {
                const dev = dmp[0];
                const mod = dmp[1];
                const arrPackEIs = dmp[2];
                const existingLength =
                  R.pathOr([], [dev, mod], existingShares)
                   .length;
                return ((existingLength + arrPackEIs.length) >= MIN_USES);               })
          )
          .do(arrDMP => {
            commonModules += arrDMP.reduce((acc, dmp) => {
              acc += dmp[2].length; // arrPackEIs length
              return acc;
            }, 0);
          })
          .do(arrDMP => { // if dryrun, output the module and shared paths
            if (options.dryrun) {
              log.clear();
              arrDMP.forEach(dkv => {
                console.log(chalk.bold(dkv[1]));
                const pathEIs = dkv[2];
                pathEIs.forEach(pEI => console.log(`  ${pEI.fullParentDir}`));
                console.log('');
              })
            }
          })
          // transform from array to obs of [dev, mod, arrPackEIs]
          .mergeMap(arrDMP => Observable.from(arrDMP),
                    CONC_OPS)
          .takeUntil(cancelled$)
          .mergeMap(
            dmp => determineModLinkSrcDst(dmp),
            CONC_OPS
          )
          .do(() => phase = 'link')
          .mergeMap(
            lnkSrcDst => (options.dryrun) ?
                       determineLinks(lnkSrcDst, false) :
                       handleModuleLinking(lnkSrcDst),
            CONC_OPS
          )
          .scan(
            (acc, x) => {
              acc += x.srcEI.stat.size;
              return acc;
            },
            0
          )
          .do(savedBytes => savedByteCount = savedBytes)
          .do(savedBytes => {
            const verb = (options.dryrun) ? 'checking:' : 'linking:';
            const saved = (options.dryrun) ? 'would save:' : 'saved:';
            log(`${chalk.bold(verb)} ${calcPerc(completedModules, commonModules)}% ${chalk.green(saved)} ${chalk.bold(formatBytes(savedBytes))}`);
          });
}

function formatModNameVersion(name, version) {
  return `${name}-${version}`;
}

function formatBytes(bytes) {
  return numeral(bytes).format('0.[00]b')
}

function calcPerc(top, bottom) {
  if (top === 0) { return 0; }
  if (bottom === 0) { return 0; }
  let perc = Math.floor(top*100/bottom);
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

function flattenObj2Levels(dmr) { // return [[d, m, r]]
  return R.toPairs(dmr)
          .map(d_mr => R.toPairs(d_mr[1])
                        .map(m_r => [d_mr[0], m_r[0], m_r[1]]))
          .reduce((acc, arr) => R.concat(acc, arr), []);
}

function rebuild2LevelObj(arrDMR, withObj = {}) { // return { d: m: r }
  // does deepMerge if withObj is provided
  return arrDMR.reduce(
    // accumulate new obj setting the lensPath([d, m]) with r
    (acc, d_m_r) => R.set(R.lensPath(R.take(2, d_m_r)),
                          d_m_r[2],
                          acc),
    withObj
  );
}

function findExistingMaster(dev, mod) { // returns Obs of masterEI_modRefs (or none)
  /*
    we will be checking through the existingShares[dev][mod] modRefs
    to see if any are still valid. Resolve with the first one that is
    still valid, also returning the remaining modRefs. Not all of the
    modRefs will have been checked, just enough to find one valid one.
    Updates existingShares to new object with updated modRefs if
    any were invalid.
    Use prune to go through and clean out all invalid ones.
    Resolves with masterEI or null
   */

  // check existingShares[dev][mod] for ref tuples
  const masterModRefs = R.pathOr([], [dev, mod], existingShares); // array of [modDir, packInode, packMTimeEpoch] modRef tuples

  return Observable.from(masterModRefs)
                   .mergeMap(
                     modRef => verifyModRef(mod, modRef, true),
                     1 // one at a time since only need first
                   )
                   .first(
                     masterEI => masterEI, // exists
                     (masterEI, idx) => [masterEI, idx],
                     null
                   )
                   .do(masterEI_idx => {
                     if (!masterEI_idx) {
                       // no valid found, clear out
                       existingShares = T.setIn(
                         existingShares,
                         [dev, mod],
                         []
                       );
                     } else if (masterEI_idx[1] !== 0) {
                       // wasn't first one so needs slicing
                       existingShares = T.setIn(
                         existingShares,
                         [dev, mod],
                         masterModRefs.slice(idx)
                       );
                     }
                   })
                   // just return masterEI or null
                   .map(masterEI_idx => {
                     return (masterEI_idx) ? masterEI_idx[0] : null;
                   });
}

function isEISameInode(firstEI, secondEI) {
  return ((firstEI.stat.dev === secondEI.stat.dev) &&
          (firstEI.stat.ino === secondEI.stat.ino));
}

function determineModLinkSrcDst(dmp) { // ret obs of srcDstObj
  const dev = dmp[0]; // device
  const mod = dmp[1]; // nameVersion
  const arrPackEI = dmp[2]; // array of package.json EI's

  if (phase === 'check') {
    log(`${chalk.bold('checking:')} ${chalk.dim(trunc(arrPackEI[0].fullParentDir))}`);
  }

  return findExistingMaster(dev, mod)
    // if no master found, then use first in arrPackEI
    .map(masterEI => (masterEI) ? masterEI : arrPackEI[0])
    .mergeMap(masterEI =>
      // use asap scheduler to prevent stack from being exceeded
      Observable.from(arrPackEI, Rx.Scheduler.asap)
                .filter(dstEI => !isEISameInode(masterEI, dstEI))
                .map(dstEI => ({
                  dev, // device
                  mod, // moduleNameVersion
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

function buildModRef(modFullPath, packageJsonInode, packageJsonMTimeEpoch) {
  return [
    modFullPath,
    packageJsonInode,
    packageJsonMTimeEpoch
  ];
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
  const dev = lnkModSrcDst.dev;
  const mod = lnkModSrcDst.mod;
  const srcRoot = lnkModSrcDst.src;
  const srcPackInode = lnkModSrcDst.srcPackInode;
  const srcPackMTimeEpoch = lnkModSrcDst.srcPackMTimeEpoch;
  const dstRoot = lnkModSrcDst.dst;
  const dstPackInode = lnkModSrcDst.dstPackInode;
  const dstPackMTimeEpoch = lnkModSrcDst.dstPackMTimeEpoch

  if (updateExistingShares) {
    existingShares =
      R.over(R.lensPath([dev, mod]),
             // if modRefs is undefined or empty, set to master
             // then append dst after filtering any previous entry
             R.pipe(

               R.defaultTo([buildModRef(srcRoot, srcPackInode, srcPackMTimeEpoch)]),
               R.when(R.propEq('length', 0), R.always([buildModRef(srcRoot, srcPackInode, srcPackMTimeEpoch)])),
               R.filter(modRef => modRef[0] !== dstRoot),
               R.append(buildModRef(dstRoot, dstPackInode, dstPackMTimeEpoch))),
             existingShares);
  }

  const fstream = readdirp({
    root: lnkModSrcDst.src,
    entryType: 'files',
    fileFilter: ['!.*'],
    directoryFilter: ['!.*', '!node_modules']
  });
  fstream.once('end', () => completedModules += 1);

  return Observable.fromEvent(fstream, 'data')
                   .takeUntil(Observable.fromEvent(fstream, 'end'))
                   .takeUntil(cancelled$)
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
                       )
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
  )
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
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(err);
    }
  }
}
