import fs from 'fs-extra-promise';
import Path from 'path';
import R from 'ramda';
import readdirp from 'readdirp';
import { Observable } from 'rxjs';
import { buildPackRef } from './pack-ref';

export function genModuleLinks(config, rtenv, lnkModSrcDst) { // returns observable
  return determineLinks(config, rtenv, lnkModSrcDst, true)
  // just output the ln commands
    .do(fileSrcAndDstEIs => {
      const srcEI = fileSrcAndDstEIs.srcEI;
      const dstEI = fileSrcAndDstEIs.dstEI;
      rtenv.out(`ln -f "${srcEI.fullPath}" "${dstEI.fullPath}"`);
    });
}

export function handleModuleLinking(config, rtenv, lnkModSrcDst) { // returns observable
  return determineLinks(config, rtenv, lnkModSrcDst, true)
    .mergeMap(
      fileSrcAndDstEIs => performLink(fileSrcAndDstEIs),
      (fileSrcAndDstEIs, ops) => fileSrcAndDstEIs,
      config.concurrentOps
    );
}

export function determineLinks(config, rtenv, lnkModSrcDst, updateExistingShares = false) { // returns observable of fileSrcAndDstEIs
  // src is the master we link from, dst is the dst link
  const devNameVer = lnkModSrcDst.devNameVer; // device:nameVersion
  const srcRoot = lnkModSrcDst.src;
  const srcPackInode = lnkModSrcDst.srcPackInode;
  const srcPackMTimeEpoch = lnkModSrcDst.srcPackMTimeEpoch;
  const dstRoot = lnkModSrcDst.dst;
  const dstPackInode = lnkModSrcDst.dstPackInode;
  const dstPackMTimeEpoch = lnkModSrcDst.dstPackMTimeEpoch;

  if (updateExistingShares) {
    const arrWithSrcPackRef = [buildPackRef(srcRoot, srcPackInode, srcPackMTimeEpoch)];
    const dstPackRef = buildPackRef(dstRoot, dstPackInode, dstPackMTimeEpoch);
    rtenv.existingShares =
      R.over(R.lensPath([devNameVer]),
             // if packRefs is undefined or empty, set to master
             // then append dst after filtering any previous entry
             R.pipe(
               R.defaultTo(arrWithSrcPackRef),
               R.when(R.propEq('length', 0), R.always(arrWithSrcPackRef)),
               R.filter(packRef => packRef[0] !== dstRoot),
               R.append(dstPackRef)),
             rtenv.existingShares);
  }

  const fstream = readdirp({
    root: lnkModSrcDst.src,
    entryType: 'files',
    lstat: true,  // want actual files not symlinked
    fileFilter: ['!.*'],
    directoryFilter: ['!.*', '!node_modules']
  });
  fstream.once('end', () => { rtenv.completedModules += 1; });
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
                      // make sure not same inode as master
                      (x.srcEI.stat.ino !== x.dstEI.stat.ino) &&
                      // same device
                      (x.srcEI.stat.dev === x.dstEI.stat.dev) &&
                      // same size
                      (x.srcEI.stat.size === x.dstEI.stat.size) &&
                      // same modified datetime
                      (x.srcEI.stat.mtime.getTime() ===
                        x.dstEI.stat.mtime.getTime()) &&
                      // big enough to care about
                      (x.dstEI.stat.size >= config.minSize)
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
