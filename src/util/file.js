import fs from 'fs-extra-promise';

export function safeJsonReadSync(file) { // returns obj, error, or undefined when not found
  try {
    const stat = fs.statSync(file);
    if (stat && stat.size) {
      try {
        return fs.readJsonSync(file);
      } catch (err) {
        return err;
      }
    }
    return undefined;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(err);
      return err;
    }
    return undefined;
  }
}

export function outputFileStderrSync(file) {
  const content = fs.readFileSync(file);
  process.stderr.write(content);
}
