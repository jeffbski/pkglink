import R from 'ramda';

export default function runAsChild(INTERRUPT_TYPE) {
  const onInterrupt = fn => { // set the onInterrupt fn to call
    const interruptOnce = R.once(fn);
    process
      .once('SIGINT', interruptOnce)
      .once('SIGTERM', interruptOnce)
      .on('message', msg => {
        if (msg && msg.type === INTERRUPT_TYPE) {
          interruptOnce();
        }
      });
  };

  const shutdown = R.once(() => {
    process.disconnect();
  });

  return {
    onInterrupt,
    shutdown
  };
}
