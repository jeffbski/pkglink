import fs from 'fs-extra-promise';
import Path from 'path';
import R from 'ramda';
import readdirp from 'readdirp';
import { Observable } from 'rxjs';
import { buildPackRef } from './pack-ref';
import linkFilter from './link-filter';

export function genModuleLinks(config, rtenv, lnkModSrcDst) { // returns observable
  return determineLinks(config, rtenv, lnkModSrcDst, true)
  // just output the ln commands
    .do(([src, dst, size]) => {
      rtenv.out(`ln -f "${src}" "${dst}"`);
    });
}

export function handleModuleLinking(config, rtenv, lnkModSrcDst) { // returns observable
  return determineLinks(config, rtenv, lnkModSrcDst, true)
    .mergeMap(
      s_d_sz => performLink(s_d_sz),
      (s_d_sz, ops) => s_d_sz,
      config.concurrentOps
    );
}

export function determineLinks(config, rtenv, lnkModSrcDst, updatePackRefs = false) { // returns observable of s_d_sz [srcFullPath, dstFullPath, size]
  // src is the master we link from, dst is the dst link
  const devNameVer = lnkModSrcDst.devNameVer; // device:nameVersion
  const srcRoot = lnkModSrcDst.src;
  const srcPackInode = lnkModSrcDst.srcPackInode;
  const srcPackMTimeEpoch = lnkModSrcDst.srcPackMTimeEpoch;
  const dstRoot = lnkModSrcDst.dst;
  const dstPackInode = lnkModSrcDst.dstPackInode;
  const dstPackMTimeEpoch = lnkModSrcDst.dstPackMTimeEpoch;

  if (updatePackRefs) {
    let packRefs = rtenv.updatedPackRefs[devNameVer] || [];
    if (!packRefs.length) {
      packRefs.push(buildPackRef(srcRoot, srcPackInode, srcPackMTimeEpoch));
    }
    packRefs = packRefs.filter(packRef => packRef[0] !== dstRoot);
    if (packRefs.length < config.refSize) {
      packRefs.push(buildPackRef(dstRoot, dstPackInode, dstPackMTimeEpoch));
    }
    rtenv.updatedPackRefs[devNameVer] = packRefs;
  }

  const fstream = readdirp({
    root: lnkModSrcDst.src,
    entryType: 'files',
    lstat: true,  // want actual files not symlinked
    fileFilter: ['!.*'],
    directoryFilter: ['!.*', '!node_modules']
  });
  fstream.once('end', () => { rtenv.completedPackages += 1; });
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
                   .filter(x => linkFilter(config, dstPackInode, x))
                   .map(x => [ // s_d_sz
                     x.srcEI.fullPath,
                     x.dstEI.fullPath,
                     x.srcEI.stat.size
                   ]);
}


function performLink([src, dst, size]) {  // returns observable
  return Observable.from(
    fs.unlinkAsync(dst)
      .then(() => fs.linkAsync(src,
                               dst))
      .catch(err => {
        console.error(`failed to unlink/link src:${src} dst:${dst}`, err);
        throw err;
      })
  );
}
