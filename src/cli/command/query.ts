import { Command } from 'commander';
import { runQuery } from '../../query/index.js';

export function registerQuery(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('query')
    .description('Query state.json with JSONPath')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .argument('<jsonpath>', 'JSONPath expression')
    .option('--state <path>', 'Override state.json path')
    .option('--format <format>', 'Output format: json, yaml', 'json')
    .action(exitOnError(async (project: string, jsonpath: string, opts: any) => {
      await runQuery(project, opts, jsonpath);
    }));
}
