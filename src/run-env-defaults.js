import { Observable } from 'rxjs';

/*
  The defaults for the runtime environment, used by CLI
  and main code for providing current status. Default log,
  log.clear, and out are no-ops
 */

function noop() { }

// placeholder, can be overridden by
function noopLog(str) { }
noopLog.clear = noop;


const rtenv = {
  cancelled: false,
  cancelled$: Observable.never(),
  CONC_OPS: 4,
  existingShares: {},
  EXTRACOLS: 60,
  log: noopLog,
  MIN_SIZE: 0,
  out: noop,
  savedByteCount: 0,
  TREE_DEPTH: 0
};


export default rtenv;
