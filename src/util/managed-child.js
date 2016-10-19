import R from 'ramda';

export default function runAsChild(INTERRUPT_TYPE) {
  const onInterrupt = fn => { // set the onInterrupt fn to call
    const onceFn = R.once(fn);
    process
      .once('SIGINT', onceFn)
      .on('message', msg => {
        if (msg && msg.type === INTERRUPT_TYPE) {
          onceFn();
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
