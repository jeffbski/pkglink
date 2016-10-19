import cluster from 'cluster';
import Readline from 'readline';
import R from 'ramda';

export default function runAsMaster(INTERRUPT_TYPE) {
  const win32 = process.platform === 'win32';
  let readline;
  if (win32) {
    readline = Readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.on('SIGINT', () => {
      process.emit('SIGINT');
    });
  }

  const shutdown = R.once(() => {
    if (readline) { readline.close(); }
  });

  function launchChildWorker(script, opts) {
    const options = R.merge({
      exec: script,
      stopTimeout: 10000 // 10s
    }, opts);
    cluster.setupMaster(options);
    const worker = cluster.fork();

    let killTimeout = null;

    process
      .once('SIGINT', () => {
        // for windows compatibility
        worker.send({ type: INTERRUPT_TYPE });

        // failsafe timer, kills child if doesn't shutdown
        killTimeout = setTimeout(() => {
          console.log('killing child');
          worker.kill('SIGTERM');
          killTimeout = null;
        }, options.stopTimeout);
      });

    worker.on('exit', code => {
      process.exitCode = code;
      if (killTimeout) {
        try {
          clearTimeout(killTimeout);
          killTimeout = null;
        } catch (err) {
          console.error(err);
        }
      }
      shutdown();
    });

    return worker;
  }

  function onInterrupt(fn) {
    process.once('SIGINT', fn);
  }

  return {
    launchChildWorker,
    onInterrupt,
    shutdown
  };

}
