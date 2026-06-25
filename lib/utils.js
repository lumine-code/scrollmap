function throttles(...args) {
  const timeout = args.pop();
  let timer = null;
  let level = -1;
  const fns = args.map((func, i) => () => {
    if (timer && level <= i) return;
    if (timer) clearTimeout(timer);
    level = i;
    timer = setTimeout(() => {
      timer = null;
      level = -1;
      func();
    }, timeout);
  });
  fns.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      level = -1;
    }
  };
  return fns;
}

module.exports = { throttles };
