import { Command } from 'commander';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti/static';
import * as z from 'zod';
import * as _ from 'lodash';
import * as yaml from 'yaml';
import { resolveProject } from '../settings.js';
import { readFileText } from '../../util/file_io.js';
import { detailedParse } from '../../util/prettified_parse.js';

export function registerValidateMvu(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('validate-mvu')
    .description('Validate initvar.yaml against schema.ts using Zod')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .option('--state <path>', 'Override state.json path and skip project lookup')
    .action(exitOnError(async (project: string, opts: { state?: string }) => {
      const { statePath } = resolveProject(project, opts);
      const projectDir = dirname(statePath);

      const state = JSON.parse(readFileText(statePath));
      if (!state.mvu) {
        throw new Error('项目未启用 MVU（tavern-cards-state.json 中 mvu 不为 true）');
      }

      const schemaPath = resolve(projectDir, 'schema.ts');
      const initvarPath = resolve(projectDir, '世界书/变量/initvar.yaml');

      if (!existsSync(schemaPath)) {
        throw new Error(`schema.ts 不存在: ${schemaPath}`);
      }
      if (!existsSync(initvarPath)) {
        throw new Error(`initvar.yaml 不存在: ${initvarPath}`);
      }

      const jiti = createJiti(import.meta.url, { interopDefault: true });

      const globalZ = globalThis as Record<string, unknown>;
      globalZ.z = z;
      globalZ._ = _;

      const { Schema } = await jiti.import(schemaPath) as { Schema: z.ZodType };

      if (!Schema) {
        throw new Error('schema.ts 未导出 Schema');
      }

      const initvarData = yaml.parse(readFileText(initvarPath));

      detailedParse(Schema, initvarData);

      console.log('validate-mvu: initvar.yaml 校验通过');
    }));
}
