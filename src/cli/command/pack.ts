import { Command } from 'commander';
import { runPack } from '../../pack/index.js';

export function registerPack(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('pack')
    .description('Pack state.json into SillyTavern PNG (character) or JSON (worldbook)')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state and --output are both provided')
    .option('--state <path>', 'Override state.json path; with --output, allows running without project lookup')
    .option('--output <path>', 'Override output artifact path; required with --state when project is not configured')
    .action(exitOnError(async (project: string, opts: { state?: string; output?: string }) => {
      await runPack(project, opts);
    }));
}
