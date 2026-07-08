import { Command } from 'commander';
import { runUnpack } from '../../unpack/index.js';

export function registerUnpack(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('unpack')
    .description('Unpack SillyTavern PNG/JSON into state.json + content files')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --file is provided')
    .option('--file <path>', 'Override input PNG/JSON path; required when project is not configured')
    .option('--output <dir>', 'Override output directory; inferred from --state in merge mode; required with --fresh when project is not configured')
    .option('--state <path>', 'Override state.json path for merging with existing state; --output defaults to its parent directory')
    .option('--raw', 'Output raw SillyTavern JSON without conversion')
    .option('--split', 'Split long content into separate files')
    .option('--fresh', 'Skip merging with existing state; overwrite as a fresh unpack')
    .action(exitOnError(async (project: string, opts: { file?: string; output?: string; state?: string; raw?: boolean; split?: boolean; fresh?: boolean }) => {
      if (opts.fresh && opts.state) {
        throw new Error('--fresh and --state are mutually exclusive: --fresh skips merging, --state specifies a state file to merge with');
      }
      await runUnpack(project, opts);
    }));
}
