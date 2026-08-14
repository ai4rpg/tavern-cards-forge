import { Command } from 'commander';
import { runExport } from '../../extract/index.js';

export function registerExport(
  program: Command,
  exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>,
) {
  program
    .command('export')
    .description(
      'Export SillyTavern-importable files (world info / regex / helper scripts) from a forge project state',
    )
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .option('--state <path>', 'Override state.json path; allows running without project lookup')
    .option('--output <dir>', 'Output directory (default: <cwd>/<projectName>-resources)')
    .option(
      '--kind <kind>',
      'Which resources to export: worldbook, regex, helper, or comma list, or all (default: all)',
    )
    .action(
      exitOnError(async (project: string, opts: { state?: string; output?: string; kind?: string }) => {
        await runExport(project, opts);
      }),
    );
}
