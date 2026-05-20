import { Command } from 'commander';
import { runUnpack } from '../../unpack/index.js';

export function registerUnpack(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('unpack')
    .description('Unpack SillyTavern PNG/JSON into state.json + content files')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --file and --output are both provided')
    .option('--file <path>', 'Override input PNG/JSON path; with --output, allows running without project lookup')
    .option('--output <dir>', 'Override output directory; required with --file when project is not configured')
    .option('--raw', 'Output raw SillyTavern JSON without conversion')
    .option('--split', 'Split long content into separate files')
    .action(exitOnError(async (project: string, opts: { file?: string; output?: string; raw?: boolean; split?: boolean }) => {
      await runUnpack(project, opts);
    }));
}
