import numeral from 'numeral';
import truncate from 'cli-truncate';

export function calcPerc(top, bottom) {
  if (top === 0) { return 0; }
  if (bottom === 0) { return 0; }
  let perc = Math.floor((top * 100) / bottom);
  if (perc < 0) perc = 0;
  if (perc > 100) perc = 100;
  return perc;
}

export function formatBytes(bytes) {
  return numeral(bytes).format('0.[00]b');
}

export function formatDevNameVersion(dev, name, version) {
  return `${dev}:${name}-${version}`;
}

export function sortObjKeys(obj) {
  return Object.keys(obj)
               .sort()
               .reduce((acc, k) => {
                 acc[k] = obj[k];
                 return acc;
               }, {});
}

export function trunc(size, str) {
  return truncate(str, size, { position: 'middle' });
}
