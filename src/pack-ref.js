import fs from 'fs-extra-promise';
import Path from 'path';
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

export function determinePackLinkSrcDst(config, rtenv, [dnv, arrPackEI]) { // ret obs of srcDstObj
  if (rtenv.cancelled) { return Observable.never(); }

  return findExistingMaster(config, rtenv, dnv, arrPackEI)
  // if no master found, then use first in arrPackEI
    .map(masterEI => masterEI || arrPackEI[0])
    .takeWhile(() => !rtenv.cancelled)
    .mergeMap(masterEI =>
      // use asap scheduler to prevent stack from being exceeded
      Observable.from(arrPackEI, Scheduler.asap)
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

function isEISameInode(firstEI, secondEI) {
  return ((firstEI.stat.dev === secondEI.stat.dev) &&
          (firstEI.stat.ino === secondEI.stat.ino));
}


function findExistingMaster(config, rtenv, dnv, arrPackEI) { // returns Obs of masterEI_packRefs (or none)
  /*
     we will be checking through the rtenv.existingPackRefs[dnv] packRefs
     to see if any are still valid. Resolve with the first one that is
     still valid, also returning the remaining packRefs. Not all of the
     packRefs will have been checked, just enough to find one valid one.
     A new array of refs will be updated in rtenv.updatedPackRefs
     which will omit any found to be invalid.
     Resolves with masterEI or uses first from arrPackEI
   */

  // check rtenv.existingPackRefs[dnv] for ref tuples
  const masterPackRefs = R.pathOr([], [dnv], rtenv.existingPackRefs); // array of [modDir, packInode, packMTimeEpoch] packRef tuples

  return Observable.from(masterPackRefs)
                   .mergeMap(
                     packRef => verifyPackRef(dnv, packRef, true),
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
                       rtenv.updatedPackRefs[dnv] = [
                         buildPackRef(packEI.fullParentDir,
                                      packEI.stat.ino,
                                      packEI.stat.mtime.getTime())
                       ];
                       return packEI;
                     } else {
                       const idx = masterEI_idx[1];
                       // wasn't first one so needs slicing
                       rtenv.updatedPackRefs[dnv] =
                         masterPackRefs.slice(idx);
                     }
                     return masterEI_idx[0];
                   });
}
