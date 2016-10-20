import fs from 'fs-extra-promise';
import Path from 'path';
import Prom from 'bluebird';
import R from 'ramda';
import { Observable, Scheduler } from 'rxjs';
import { formatDevNameVersion } from './util/format';

export function prune(config, dnvPR) { // return obs of new dnvPR object
  return Observable.from(
    R.toPairs(dnvPR) // [dnv, arrPackRef]
  )
                   .mergeMap(dnv_PR => verifyDMP(dnv_PR, config))
                   .reduce((acc, dnv_PR) => R.append(dnv_PR, acc),
                           [])
                   .map(flatDMR => R.fromPairs(flatDMR));
}

export function verifyDMP([dnv, arrPackRef], config) {  // return obs of valid dnv_PR
  const { concurrentOps } = config;
  return Observable.from(arrPackRef) // obs of packRefs
  // returns obs of valid packRef
                   .mergeMap(packRef => verifyPackRef(dnv, packRef, false),
                             concurrentOps)
                   .reduce((acc, packRef) => R.append(packRef, acc),
                           [])
                   .filter(arrRefEI => arrRefEI.length)
                   .map(arrRefEI => [dnv, arrRefEI]); // dnv_PR
}

export function buildPackRef(modFullPath, packageJsonInode, packageJsonMTimeEpoch) {
  return [
    modFullPath,
    packageJsonInode,
    packageJsonMTimeEpoch
  ];
}

export function verifyPackRef(dnv, packRef, returnEI = false) { // return obs of valid packRef
  const modDir = packRef[0];
  const packInode = packRef[1];
  const packMTimeEpoch = packRef[2];
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
    // if json and matches, return packRef or EI
                           .then(json => { // eslint-disable-line consistent-return
                             if (json) {
                               const devNameVer = formatDevNameVersion(packStat.dev, json.name, json.version);
                               if (devNameVer === dnv) {
                                 return (returnEI) ?
                                        { // masterEI
                                          stat: packStat,
                                          fullParentDir: modDir
                                        } :
                                        packRef;
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

const masterEICache = { };

function checkMasterCache(config, rtenv, dnv, packEI) { // ret obs of masterEI
  const masterEI = masterEICache[dnv];
  if (masterEI) {
    if (!masterEI.then) { // it is not a promise
      return Observable.of(masterEI);
    }
    // otherwise it was a promise
    return Observable.fromPromise(masterEI);
  }
  // otherwise not found
  const masterEIProm = findExistingMaster(config, rtenv, dnv, packEI);
  masterEICache[dnv] = masterEIProm;
  // optimize future requests so they don't need to hit promise
  masterEIProm
    .then(masterEI => {
      masterEICache[dnv] = masterEI; // eliminate promise overhead
    });
  return Observable.fromPromise(masterEIProm);
}


export function determinePackLinkSrcDst(config, rtenv, destEIdn) { // ret obs of srcDstObj
  if (rtenv.cancelled) { return Observable.empty(); }
  const { entryInfo: dstEI, devNameVer: dnv } = destEIdn;

  return checkMasterCache(config, rtenv, dnv, dstEI)
    .takeWhile(() => !rtenv.cancelled)
    .filter(masterEI => !isEISameInode(masterEI, dstEI))
    .map(masterEI => ({
      devNameVer: dnv, // device:nameVersion
      src: masterEI.fullParentDir,
      srcPackInode: masterEI.stat.ino,
      srcPackMTimeEpoch: masterEI.stat.mtime.getTime(),
      dst: dstEI.fullParentDir,
      dstPackInode: dstEI.stat.ino,
      dstPackMTimeEpoch: dstEI.stat.mtime.getTime()
    }));
}

function isEISameInode(firstEI, secondEI) {
  return ((firstEI.stat.dev === secondEI.stat.dev) &&
          (firstEI.stat.ino === secondEI.stat.ino));
}

// prepare for this to be async
function getExistingPackRefs(config, rtenv, dnv) { // returns observable to arrPackRefs
  // check rtenv.existingPackRefs[dnv] for ref tuples
  const masterPackRefs = R.pathOr([], [dnv], rtenv.existingPackRefs); // array of [modDir, packInode, packMTimeEpoch] packRef tuples
  return Observable.of(masterPackRefs);
}

function findExistingMaster(config, rtenv, dnv, ei) { // returns promise resolving to masterEI
  /*
     we will be checking through the rtenv.existingPackRefs[dnv] packRefs
     to see if any are still valid. Resolve with the first one that is
     still valid, also returning the remaining packRefs. Not all of the
     packRefs will have been checked, just enough to find one valid one.
     A new array of refs will be updated in rtenv.updatedPackRefs
     which will omit any found to be invalid.
     Resolves with masterEI or uses ei provided
   */
  return getExistingPackRefs(config, rtenv, dnv)
    .mergeMap(masterPackRefs => {
      if (!masterPackRefs.length) {
        // no valid found, set to empty []
        rtenv.updatedPackRefs[dnv] = [
          buildPackRef(ei.fullParentDir,
                       ei.stat.ino,
                       ei.stat.mtime.getTime())
        ];
        return Observable.of(ei);
      }
      // otherwise we have packrefs check them
      return Observable.from(masterPackRefs)
                       .mergeMap(
                         packRef => verifyPackRef(dnv, packRef, true),
                         1 // one at a time since only need first
                       )
                       .first(
                         masterEI => masterEI, // exists
                         (masterEI, idx) => [masterEI, idx],
                         false
                       )
                       .map(masterEI_idx => {
                         if (!masterEI_idx) {
                           // no valid found, set to empty []
                           rtenv.updatedPackRefs[dnv] = [
                             buildPackRef(ei.fullParentDir,
                                          ei.stat.ino,
                                          ei.stat.mtime.getTime())
                           ];
                           return ei;
                         }
                         const idx = masterEI_idx[1];
                         // wasn't first one so needs slicing
                         rtenv.updatedPackRefs[dnv] =
                           masterPackRefs.slice(idx);
                         const masterEI = masterEI_idx[0];
                         return masterEI;
                       });
    })
    .toPromise(Prom);
}
