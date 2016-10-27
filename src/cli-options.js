import chalk from 'chalk';
import Joi from 'joi';
import minimist from 'minimist';
import OS from 'os';
import Path from 'path';
import R from 'ramda';
import { safeJsonReadSync } from './util/file';
import { DEFAULT_CONFIG_FILE, DEFAULT_REFS_FILE } from './constants';

const minimistOpts = {
  boolean: ['d', 'g', 'h', 'p', 'v'],
  string: ['c', 'm', 'r'],
  alias: {
    c: 'config',
    d: 'dryrun',
    g: 'gen-ln-cmds',
    h: 'help',
    m: 'memory',
    p: 'prune',
    r: 'refs-file',
    t: 'tree-depth',
    v: 'verbose'
  }
};

export const argvSchema = Joi.object({
  config: Joi.string(),
  'refs-file': Joi.string(),
  size: Joi.number().integer().min(0),
  'tree-depth': Joi.number().integer().min(0)
}).unknown();

export const configSchema = Joi.object({
  refsFile: Joi.string().default(
    Path.resolve(OS.homedir(), DEFAULT_REFS_FILE)),
  concurrentOps: Joi.number().integer().min(1).default(4),
  // windows does not maintain original modtimes for installs
  // so ignoreModTime is defaulted to true for win32
  ignoreModTime: Joi.boolean()
                    .default(OS.platform() === 'win32'),
  memory: Joi.number().integer().min(100).default(2048), // MB
  minFileSize: Joi.number().integer().min(0).default(0), // bytes
  treeDepth: Joi.number().integer().min(0).default(0),
  refSize: Joi.number().integer().min(1).default(5),
  consoleWidth: Joi.number().integer().min(30).default(70)
});

export function gatherOptions(processArgv, displayHelp) {
  // processArgv is already sliced, process.argv.slice(2)
  const unvalidArgv = minimist(processArgv, minimistOpts);
  const argvVResult = Joi.validate(unvalidArgv, argvSchema);
  if (argvVResult.error) {
    if (displayHelp) { displayHelp(); }
    console.error('');
    console.error(chalk.red('error: invalid argument specified'));
    argvVResult.error.details.forEach(err => {
      console.error(err.message);
    });
    process.exit(20);
  }
  const argv = argvVResult.value; // possibly updated by schema
  return argv;
}

export function gatherConfig(argv, unvalidatedConfig, configPath) {
  const configResult = Joi.validate(unvalidatedConfig, configSchema, { abortEarly: false });
  if (configResult.error) {
    console.error(chalk.red('error: invalid JSON configuration'));
    console.error(`${chalk.bold('config file:')} ${configPath}`);
    configResult.error.details.forEach(err => {
      console.error(err.message);
    });
    process.exit(22);
  }
  const config = configResult.value; // with defaults applied
  R.toPairs({ // for these defined argv values override config
    dryrun: argv.dryrun,
    genLnCmds: argv['gen-ln-cmds'],
    memory: argv.memory,
    refsFile: argv['refs-file'],
    treeDepth: argv['tree-depth']
  }).forEach(p => {
    const k = p[0];
    const v = p[1];
    if (!R.isNil(v)) { // if defined, use it
      config[k] = v;
    }
  });
  config.extraCols = config.consoleWidth - 30;
  return config;
}

export function gatherOptionsConfig(processArgv, displayHelp) {
  const argv = gatherOptions(processArgv, displayHelp);

  const CONFIG_PATH = argv.config ||
                      Path.resolve(OS.homedir(), DEFAULT_CONFIG_FILE);

  const parsedConfigJson = safeJsonReadSync(CONFIG_PATH);
  if (parsedConfigJson instanceof Error) {
    console.error(chalk.red('error: invalid JSON configuration'));
    console.error(`${chalk.bold('config file:')} ${CONFIG_PATH}`);
    console.error(parsedConfigJson); // error
    process.exit(21);
  }
  const unvalidatedConfig = parsedConfigJson || {};

  const config = gatherConfig(argv, unvalidatedConfig, CONFIG_PATH);

  return {
    argv,
    config
  };

}
