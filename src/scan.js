import chalk from 'chalk';
import { createLogUpdate } from './util/log';
import { genModuleLinks, handleModuleLinking,
         determineLinks } from './link';
import { determinePackLinkSrcDst, buildPackRef } from './pack-ref';
import findPackages from './find-packages';

export default function scanAndLink(config, rtenv, rootDirs) {
  const logUpdate = createLogUpdate(config, rtenv);

  const outputSrcDstForDryrun = (config.dryrun) ?
                                lnkSrcDst => {
      const { devNameVer: dnv, src, dst } = lnkSrcDst;
      rtenv.log.clear();
      rtenv.out(chalk.bold(dnv.split(':')[0])); // nameVersion
      rtenv.out(`  ${src}`);
      rtenv.out(`  ${dst}`);
      rtenv.out('');
    } :
    () => {};

  return findPackages(config, rtenv, rootDirs, logUpdate)
    .takeWhile(() => !rtenv.cancelled)
    .mergeMap(
      eiDN => determinePackLinkSrcDst(config, rtenv, eiDN),
      config.concurrentOps
    )
    .takeWhile(() => !rtenv.cancelled)
    .do(lnkSrcDst => outputSrcDstForDryrun(lnkSrcDst))
    .do(lnkSrcDst => {
      rtenv.currentPackageDir = lnkSrcDst.dst;
      logUpdate();
    })
    .mergeMap(
      lnkSrcDst => {
        if (config.dryrun) {
          return determineLinks(config, rtenv, lnkSrcDst, false);
        } else if (config.genLnCmds) {
          return genModuleLinks(config, rtenv, lnkSrcDst);
        }
        return handleModuleLinking(config, rtenv, lnkSrcDst);
      },
      config.concurrentOps
    )

    .scan(
      (acc, [src, dst, size]) => {
        acc += size;
        return acc;
      },
      0
    )
    .do(savedBytes => { rtenv.savedByteCount = savedBytes; })
    .do(savedBytes => logUpdate());
}
