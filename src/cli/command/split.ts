import { Command } from 'commander';
import { runSplit } from '../../extract/index.js';

export function registerSplit(
  program: Command,
  exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>,
) {
  program
    .command('split')
    .description(
      'Split a SillyTavern character card (PNG or JSON) into SillyTavern-importable files (world info / regex / helper scripts)',
    )
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --file is provided')
    .option('--file <path>', 'Input character card (PNG or JSON); required without a configured project')
    .option('--output <dir>', 'Output directory (default: <cwd>/<worldbookName>-split)')
    .option(
      '--kind <kind>',
      'Which resources to split: worldbook, regex, helper, or comma list, or all (default: all)',
    )
    .action(
      exitOnError(async (project: string, opts: { file?: string; output?: string; kind?: string }) => {
        await runSplit(project, opts);
      }),
    );
}
