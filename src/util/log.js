import chalk from 'chalk';
import numeral from 'numeral';
import R from 'ramda';
import { Subject } from 'rxjs';
import { calcPerc, formatBytes, trunc } from './format';

export function createLogOnceChecking(rtenv) {
  const logOnceChecking = R.once(() => {
    rtenv.log('checking for new links...');
  });
  return logOnceChecking;
}

export function createLogScan(config, rtenv) {
  // throttle logging of scan updates
  const logScan$ = new Subject();
  logScan$
    .throttleTime(100) // throttle scan updates 100ms each
    .subscribe(x => {
      rtenv.log(`${chalk.blue('pkgs:')} ${numeral(x.packageCount).format('0,0')} ${chalk.bold('scanning:')} ${chalk.dim(trunc(config.extraCols, x.obj.entryInfo.fullParentDir))}`);
    });

  return function logScan(packageCount, obj) {
    logScan$.next({ packageCount, obj });
  };
}

export function createLogLinking(config, rtenv) {
  // throttle log of linking updates
  const linkVerb = (config.dryrun) ? 'checking:' : 'linking:';
  const linkSaved = (config.dryrun) ? 'would save:' : 'saved:';
  const logLinking$ = new Subject();
  logLinking$
    .throttleTime(100) // throttle link updates 100ms each
    .subscribe(x => {
      rtenv.log(`${chalk.bold(linkVerb)} ${calcPerc(x.completedModules, x.packageCount)}% ${chalk.green(linkSaved)} ${chalk.bold(formatBytes(x.savedBytes))}`);
    });

  return function logLinking(completedModules, packageCount, savedBytes) {
    logLinking$.next({ completedModules, packageCount, savedBytes });
  };
}
