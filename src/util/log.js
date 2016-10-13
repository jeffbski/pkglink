import chalk from 'chalk';
import numeral from 'numeral';
import R from 'ramda';
import { Subject } from 'rxjs';
import { calcPerc, formatBytes, trunc } from './format';

// eslint-disable-next-line import/prefer-default-export
export function createLogUpdate(config, rtenv) {
  // throttle logging of scan updates
  const logUpdate$ = new Subject();
  const linkSaved = (config.dryrun) ? 'saves:' : 'saved:';
  logUpdate$
    .throttleTime(100) // throttle scan updates 100ms each
    .subscribe(() => {
      const perc = calcPerc(rtenv.completedModules, rtenv.packageCount);
      rtenv.log(`${perc}% ${chalk.blue('pkgs:')} ${numeral(rtenv.completedModules).format('0,0')} ${chalk.green(linkSaved)} ${chalk.bold(formatBytes(rtenv.savedByteCount))} ${chalk.dim(trunc(config.extraCols, rtenv.currentPackageDir))}`);
    });

  return function logUpdate() {
    logUpdate$.next();
  };
}
