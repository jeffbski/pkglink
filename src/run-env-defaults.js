import { Observable } from 'rxjs';

/*
  The defaults for the runtime environment, used by CLI
  and main code for providing current status. Default log,
  log.clear, and out are no-ops, will likely be overridden
 */

function noop() { }

// placeholder, can be overridden
function noopLog(str) { }
noopLog.clear = noop;


const rtenv = {
  cancelled: false,
  cancelled$: Observable.never(),
  completedPackages: 0,
  currentPackageDir: '',
  existingPackRefs: {},
  log: noopLog,
  updatedPackRefs: {},
  out: noop,
  packageCount: 0,
  savedByteCount: 0
};


export default rtenv;
