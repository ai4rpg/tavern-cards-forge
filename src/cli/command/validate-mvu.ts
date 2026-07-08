import { Command } from 'commander';
import { dirname, resolve, isAbsolute } from 'node:path';
import { resolveProject } from '../settings.js';
import { readFileText } from '../../util/file_io.js';
import { validateMvuInitvar } from '../../util/mvu_schema.js';

export function registerValidateMvu(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('validate-mvu')
    .description('Validate initvar.yaml against schema.ts using Zod')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .option('--state <path>', 'Override state.json path and skip project lookup')
    .option('--initvar <path>', 'Path to initvar YAML file; defaults to 世界书/变量/initvar.yaml under project root')
    .action(exitOnError(async (project: string, opts: { state?: string; initvar?: string }) => {
      const cwd = process.cwd();
      const { statePath } = resolveProject(project, opts);
      const projectDir = dirname(statePath);

      const state = JSON.parse(readFileText(statePath));
      if (!state.mvu) {
        throw new Error('MVU not enabled (tavern-cards-state.json mvu is not true)');
      }

      if (!state.zod) {
        throw new Error(
          'MVU project has no Zod descriptor (state.zod is missing); cannot validate.\n' +
          'Run `forge unpack` to auto-populate state.zod, or manually edit state.json to add the zod field.'
        );
      }

      const schemaAbsPath = resolve(projectDir, state.zod.schemaPath);

      const initvarOverride = opts.initvar
        ? (isAbsolute(opts.initvar) ? opts.initvar : resolve(cwd, opts.initvar))
        : undefined;

      const result = await validateMvuInitvar(
        projectDir, state.entryManifest, initvarOverride,
        { schemaPath: schemaAbsPath },
      );
      if (result === null) {
        throw new Error(`schema.ts not found: ${schemaAbsPath}`);
      }
      console.log(`validate-mvu: ${result.initvarPath} 校验通过`);
    }));
}
