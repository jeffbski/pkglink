import chalk from 'chalk';
import numeral from 'numeral';
import { Subject } from 'rxjs';
import { formatBytes, trunc } from './format';

// eslint-disable-next-line import/prefer-default-export
export function createLogUpdate(config, rtenv) {
  // throttle logging of scan updates
  const logUpdate$ = new Subject();
  const linkSaved = config.dryrun ? 'saves:' : 'saved:';
  logUpdate$
    .throttleTime(100) // throttle scan updates 100ms each
    .subscribe(() => {
      rtenv.log(
        `${chalk.blue('pkgs:')} ${numeral(rtenv.completedPackages).format('0,0')}/${numeral(rtenv.packageCount).format(
          '0,0'
        )} ${chalk.green(linkSaved)} ${chalk.bold(formatBytes(rtenv.savedByteCount))} ${chalk.dim(
          trunc(config.extraCols, rtenv.currentPackageDir)
        )}`
      );
    });

  return function logUpdate() {
    logUpdate$.next();
  };
}
