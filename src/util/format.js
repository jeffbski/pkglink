import numeral from 'numeral';
import truncate from 'cli-truncate';

export function formatBytes(bytes) {
  return numeral(bytes).format('0.[00]b');
}

export function formatDevNameVersion(dev, name, version) {
  // use name-version first since device is usually constant
  return `${name}-${version}:${dev}`;
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
