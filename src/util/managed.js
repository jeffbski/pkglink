import runAsManagedChild from './managed-child';
import runAsMaster from './managed-master';

const INTERRUPT_TYPE = 'INTERRUPT_SHUTDOWN';

let launchWorkerMain = () => { }; // defined later

function launchWorker(script, opts) {
  return launchWorkerMain(script, opts);
}

if (process.disconnect) { // running as a child
  const childMethods = runAsManagedChild(INTERRUPT_TYPE);
  launchWorker.onInterrupt = childMethods.onInterrupt;
  launchWorker.shutdown = childMethods.shutdown;
} else { // otherwise running as master
  const masterMethods = runAsMaster(INTERRUPT_TYPE);
  launchWorkerMain = masterMethods.launchChildWorker;
  launchWorker.onInterrupt = masterMethods.onInterrupt;
  launchWorker.shutdown = masterMethods.shutdown;
}

export default launchWorker;
