import chalk from 'chalk';
import fs from 'fs-extra-promise';
import numeral from 'numeral';
import Path from 'path';
import R from 'ramda';
import readdirp from 'readdirp';
import Rx, { Observable } from 'rxjs';
import T from 'timm';
import { calcPerc, formatBytes, formatDevNameVersion,
         trunc } from './util/format';

const ENDS_NODE_MOD_RE = /[\\\/]node_modules$/;
let packageCount = 0;
let completedModules = 0;

export function prune(dnvMR, config) { // return obs of new dnvMR object
  return Observable.from(
    R.toPairs(dnvMR) // [dnv, arrModRefs]
  )
  .mergeMap(dnv_MR => verifyDMR(dnv_MR, config))
  .reduce((acc, dnv_MR) => R.append(dnv_MR, acc),
          [])
  .map(flatDMR => R.fromPairs(flatDMR));
}

function verifyDMR([dnv, arrModRefs], config) {  // return obs of valid dnv_MR
  const { concurrentOps } = config;
  return Observable.from(arrModRefs) // obs of modRefs
  // returns obs of valid modRef
                   .mergeMap(modRef => verifyModRef(dnv, modRef, false),
                             concurrentOps)
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

/*
  Special directory tree filter for finding node_module/X packages
    - no dirs starting with '.'
    - accept node_modules
    - if under ancestor of node_modules
      - allow if parent is node_modules (keep in node_modules/X tree)
      - otherwise allow (not yet found node_modules tree)
 */
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

export function scanAndLink(rootDirs, config, rtenv) {

  const logOnceChecking = R.once(() => {
    rtenv.log('checking for new links...');
  });

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
              if (config.treeDepth) { readdirpOptions.depth = config.treeDepth; }
              const fstream = readdirp(readdirpOptions);
              rtenv.cancelled$.subscribe(() => fstream.destroy()); // stop reading
              return Observable.fromEvent(fstream, 'data')
                               .takeWhile(() => !rtenv.cancelled)
                               .takeUntil(Observable.fromEvent(fstream, 'close'))
                               .takeUntil(Observable.fromEvent(fstream, 'end'));
            },
            config.concurrentOps
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
            config.concurrentOps
          )
          .filter(obj => obj.devNameVer) // has name and version, not null
          .do(obj => { packageCount += 1; })
          .do(obj => rtenv.log(`${chalk.blue('pkgs:')} ${numeral(packageCount).format('0,0')} ${chalk.bold('scanning:')} ${chalk.dim(trunc(config.extraCols, obj.entryInfo.fullParentDir))}`))
          .groupBy(eiDN => eiDN.devNameVer)
          .mergeMap(group => {
            return group.reduce((acc, eiDN) => {
              acc.push(eiDN.entryInfo);
              return acc;
            }, [])
            .map(arrEI => [group.key, arrEI]); // [devNameVer, arrPackEI]
          })
          .do(dnv_packEIs => { // if dryrun, output the module and shared paths
            if (config.dryrun) {
              rtenv.log.clear();
              const [dnv, packEIs] = dnv_packEIs;
              if (rtenv.cancelled) { return; }
              rtenv.out(chalk.bold(dnv.split(':')[1])); // nameVersion
              packEIs.forEach(pEI => rtenv.out(`  ${pEI.fullParentDir}`));
              rtenv.out('');
            }
          })
          .takeWhile(() => !rtenv.cancelled)
          .do(() => { logOnceChecking(); })
          .mergeMap(
            dnv_p => determineModLinkSrcDst(dnv_p),
            config.concurrentOps
          )
          .takeWhile(() => !rtenv.cancelled)
          .mergeMap(
            lnkSrcDst => {
              if (config.dryrun) {
                return determineLinks(lnkSrcDst, false);
              } else if (config.genLnCmds) {
                return genModuleLinks(lnkSrcDst);
              }
              return handleModuleLinking(lnkSrcDst);
            },
            config.concurrentOps
          )
          .scan(
            (acc, x) => {
              acc += x.srcEI.stat.size;
              return acc;
            },
            0
          )
          .do(savedBytes => { rtenv.savedByteCount = savedBytes; })
          .do(savedBytes => {
            const verb = (config.dryrun) ? 'checking:' : 'linking:';
            const saved = (config.dryrun) ? 'would save:' : 'saved:';
            rtenv.log(`${chalk.bold(verb)} ${calcPerc(completedModules, packageCount)}% ${chalk.green(saved)} ${chalk.bold(formatBytes(savedBytes))}`);
          });


  function determineModLinkSrcDst([dnv, arrPackEI]) { // ret obs of srcDstObj
    if (rtenv.cancelled) { return Observable.never(); }

    return findExistingMaster(dnv, arrPackEI)
    // if no master found, then use first in arrPackEI
      .map(masterEI => masterEI || arrPackEI[0])
      .takeWhile(() => !rtenv.cancelled)
      .mergeMap(masterEI =>
        // use asap scheduler to prevent stack from being exceeded
        Observable.from(arrPackEI, Rx.Scheduler.asap)
                  .takeWhile(() => !rtenv.cancelled)
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
                config.concurrentOps
      );
  }

  function findExistingMaster(dnv, arrPackEI) { // returns Obs of masterEI_modRefs (or none)
    /*
       we will be checking through the rtenv.existingShares[dnv] modRefs
       to see if any are still valid. Resolve with the first one that is
       still valid, also returning the remaining modRefs. Not all of the
       modRefs will have been checked, just enough to find one valid one.
       Updates existingShares to new object with updated modRefs if
       any were invalid.
       Use prune to go through and clean out all invalid ones.
       Resolves with masterEI or uses first from arrPackEI
     */

    // check rtenv.existingShares[dnv] for ref tuples
    const masterModRefs = R.pathOr([], [dnv], rtenv.existingShares); // array of [modDir, packInode, packMTimeEpoch] modRef tuples

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
                         rtenv.existingShares = T.setIn(
                           rtenv.existingShares,
                           [dnv],
                           [buildModRef(packEI.fullParentDir,
                                        packEI.stat.ino,
                                        packEI.stat.mtime.getTime())]
                         );
                         return packEI;
                       } else if (masterEI_idx[1] !== 0) {
                         const idx = masterEI_idx[1];
                         // wasn't first one so needs slicing
                         rtenv.existingShares = T.setIn(
                           rtenv.existingShares,
                           [dnv],
                           masterModRefs.slice(idx)
                         );
                       }
                       return masterEI_idx[0];
                     });
  }

  function genModuleLinks(lnkModSrcDst) { // returns observable
    return determineLinks(lnkModSrcDst, true)
    // just output the ln commands
      .do(fileSrcAndDstEIs => {
        const srcEI = fileSrcAndDstEIs.srcEI;
        const dstEI = fileSrcAndDstEIs.dstEI;
        rtenv.out(`ln -f "${srcEI.fullPath}" "${dstEI.fullPath}"`);
      });
  }

  function handleModuleLinking(lnkModSrcDst) { // returns observable
    return determineLinks(lnkModSrcDst, true)
      .mergeMap(
        fileSrcAndDstEIs => performLink(fileSrcAndDstEIs),
        (fileSrcAndDstEIs, ops) => fileSrcAndDstEIs,
        config.concurrentOps
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
      rtenv.existingShares =
        R.over(R.lensPath([devNameVer]),
               // if modRefs is undefined or empty, set to master
               // then append dst after filtering any previous entry
               R.pipe(
                 R.defaultTo(arrWithSrcModRef),
                 R.when(R.propEq('length', 0), R.always(arrWithSrcModRef)),
                 R.filter(modRef => modRef[0] !== dstRoot),
                 R.append(dstModRef)),
               rtenv.existingShares);
    }

    const fstream = readdirp({
      root: lnkModSrcDst.src,
      entryType: 'files',
      lstat: true,  // want actual files not symlinked
      fileFilter: ['!.*'],
      directoryFilter: ['!.*', '!node_modules']
    });
    fstream.once('end', () => { completedModules += 1; });
    rtenv.cancelled$.subscribe(() => fstream.destroy()); // stop reading

    return Observable.fromEvent(fstream, 'data')
                     .takeWhile(() => !rtenv.cancelled)
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
                       config.concurrentOps
                     )
                     .filter(x =>
                       // filter out missing targets
                       ((x.dstEI) &&
                        // take only non-package.json, existingShares uses
                        (x.dstEI.stat.ino !== dstPackInode) &&
                        // big enough to care about
                        (x.dstEI.stat.size >= config.minSize) &&
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
