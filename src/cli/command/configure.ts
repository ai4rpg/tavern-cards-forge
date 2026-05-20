import { Command } from 'commander';
import { runConfigure } from '../../configure/index.js';

export function registerConfigure(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('configure')
    .description('Derive and fill missing entry config fields (strategy/position/order)')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .option('--state <path>', 'Override state.json path and skip project lookup')
    .option('--force', 'Force overwrite existing values')
    .action(exitOnError(async (project: string, opts: { state?: string; force?: boolean }) => {
      await runConfigure(project, opts);
    }));
}
