import chalk from 'chalk';
import { createLogOnceChecking, createLogLinking } from './util/log';
import { genModuleLinks, handleModuleLinking,
         determineLinks } from './link';
import { determinePackLinkSrcDst } from './pack-ref';
import findPackagesGrouped from './find-packages';

export default function scanAndLink(config, rtenv, rootDirs) {
  const logOnceChecking = createLogOnceChecking(rtenv);
  const logLinking = createLogLinking(config, rtenv);

  return findPackagesGrouped(config, rtenv, rootDirs)
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
      dnv_p => determinePackLinkSrcDst(config, rtenv, dnv_p),
      config.concurrentOps
    )
    .takeWhile(() => !rtenv.cancelled)
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
      (acc, x) => {
        acc += x.srcEI.stat.size;
        return acc;
      },
      0
    )
    .do(savedBytes => { rtenv.savedByteCount = savedBytes; })
    .do(savedBytes => logLinking(rtenv.completedModules, rtenv.packageCount, savedBytes));

}
