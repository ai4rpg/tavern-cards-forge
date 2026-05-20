import { Command } from 'commander';
import { resolve } from 'node:path';
import { runPatch } from '../../patch/index.js';
import { readFileText, readStdin } from '../../util/file_io.js';
import type { Operation } from '../../patch/patterns.js';

export function registerPatch(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('patch')
    .description('Apply RFC 6902 JSON Patch to state.json')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .argument('[patch]', 'JSON Patch array (string)')
    .option('--file <path>', 'Read patch from file')
    .option('--state <path>', 'Override state.json path and skip project lookup')
    .option('--dry-run', 'Preview changes without writing')
    .option('--no-backup', 'Skip backup creation')
    .action(exitOnError(async (project: string, patchStr: string | undefined, opts: { file?: string; state?: string; dryRun?: boolean; noBackup?: boolean }) => {
      const cwd = process.cwd();
      let patches: Operation[];

      if (opts.file) {
        const patchPath = resolve(cwd, opts.file);
        patches = JSON.parse(readFileText(patchPath)) as Operation[];
      } else if (patchStr !== undefined) {
        patches = JSON.parse(patchStr) as Operation[];
      } else {
        const input = await readStdin();
        patches = JSON.parse(input) as Operation[];
      }

      if (!Array.isArray(patches)) {
        throw new Error('Patch must be an array of operations.');
      }

      await runPatch(project, patches, opts);
    }));
}
