import { Command } from 'commander';
import { registerPack } from './command/pack.js';
import { registerUnpack } from './command/unpack.js';
import { registerQuery } from './command/query.js';
import { registerPatch } from './command/patch.js';
import { registerConfigure } from './command/configure.js';
import { registerInit } from './command/init.js';
import { registerValidateMvu } from './command/validate-mvu.js';
import { ProjectNotFoundError } from './settings.js';

function exitOnError(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof ProjectNotFoundError) {
        console.error(e.message);
      } else if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error(String(e));
      }
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name('tavern-cards-forge')
  .description('CLI tool for offline packing/unpacking SillyTavern character cards and worldbooks')
  .version('0.1.0');

registerPack(program, exitOnError);
registerUnpack(program, exitOnError);
registerQuery(program, exitOnError);
registerPatch(program, exitOnError);
registerConfigure(program, exitOnError);
registerInit(program, exitOnError);
registerValidateMvu(program, exitOnError);

program.parse();
