import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import * as z from 'zod';
import { readFileText } from '../util/file_io.js';
import { validateAllFilePaths } from '../util/file_paths.js';
import { buildWorldbookJson, buildCharacterPng, buildCharacterJson } from './build.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolveProject, requireConfiguredProject } from '../cli/settings.js';
import { detectMvu, validateMvuEnabledState } from '../util/detect_mvu.js';
import {
  validateMvuInitvar,
  validateZodScriptContent,
  formatZodScriptValidationErrors,
  prepareZodSync,
  loadMvuSchema,
} from '../util/mvu_schema.js';

export async function runPack(project: string, opts: { state?: string; output?: string }) {
  const { cardrc, statePath, artifactPath: defaultArtifact, projectFound } = resolveProject(project, { state: opts.state, artifact: opts.output });
  if (!projectFound && (!opts.state || !opts.output)) {
    requireConfiguredProject(project, projectFound, 'Without a configured project, both --state and --output are required.');
  }

  let output = opts.output ?? defaultArtifact;
  const stateDir = dirname(statePath);
  const stateRaw = JSON.parse(readFileText(statePath));
  const state = detailedParse(TavernCardsState, stateRaw);

  const validation = validateAllFilePaths(state, stateDir);
  const missing = validation.filter(v => !v.exists);
  if (missing.length > 0) {
    throw new Error('Missing files:\n' + missing.map(m => `  - ${m.path}`).join('\n'));
  }

  // 预计算 zodSync（MVU 校验 + build 阶段复用，避免重复读盘）
  let zodSync: { schemaContent: string; zodSubject: string } | undefined;

  // When mvu is declared, verify initvar entries & MVU script are actually present
  if (state.mvu) {
    if (!state.zod) {
      console.warn(
        '⚠ MVU enabled but state.zod is missing; run `forge unpack` to auto-populate.\n' +
        '  Zod validation and schema.ts consistency checks skipped.'
      );
    }

    // Resolve script_file → content so detectMvu can inspect imports
    let detectState = state;
    const scripts = state.extensions?.tavern_helper?.scripts;
    if (scripts) {
      const resolvedScripts: Record<string, any> = {};
      for (const [name, script] of Object.entries(scripts)) {
        if (script.script_file) {
          const absPath = resolve(stateDir, script.script_file);
          try {
            const content = readFileText(absPath);
            const { script_file, ...rest } = script;
            resolvedScripts[name] = { ...rest, content };
          } catch {
            resolvedScripts[name] = script;
          }
        } else {
          resolvedScripts[name] = script;
        }
      }
      detectState = { ...state, extensions: { ...state.extensions, tavern_helper: { ...state.extensions!.tavern_helper, scripts: resolvedScripts } } };
    }
    if (!detectMvu(detectState)) {
      throw new Error('state.mvu = true but no [InitVar] entry or MagVarUpdate script found');
    }

    // 1. Zod 脚本内容校验 + 预计算 zodSync
    if (state.zod) {
      zodSync = prepareZodSync(stateDir, state.zod);
      const issues = validateZodScriptContent(zodSync.zodSubject);
      const errors = formatZodScriptValidationErrors(
        issues, zodSync.zodSubject,
        `"${state.zod.scriptName}" (rebuilt from ${state.zod.schemaPath})`,
      );
      if (errors.length > 0) throw new Error(errors.join('\n'));
    }

    // 2. 校验 MVU 条目和脚本的启用状态
    const enabledErrors = validateMvuEnabledState(state);
    if (enabledErrors.length > 0) {
      throw new Error('MVU enabled state validation failed:\n' + enabledErrors.map(e => `  - ${e}`).join('\n'));
    }

    // 3. 校验默认 initvar 与 schema.ts 一致性
    //    加载 Schema 实例一次，后续所有 initvar 校验复用（避免多次 jiti 初始化）
    let schemaInstance: z.ZodType | undefined;
    const schemaAbsPath = zodSync ? resolve(stateDir, state.zod!.schemaPath) : undefined;
    if (schemaAbsPath && existsSync(schemaAbsPath)) {
      schemaInstance = await loadMvuSchema(schemaAbsPath, { schemaContent: zodSync?.schemaContent });
    }

    const result = await validateMvuInitvar(
      stateDir, state.entryManifest,
      undefined,
      schemaInstance ? { schemaPath: schemaAbsPath!, schema: schemaInstance } : undefined,
    );
    if (result) {
      console.log(`✓ MVU validation passed: ${result.initvarPath} matches schema.ts`);
    } else {
      console.log('ℹ MVU project but schema.ts not found, skipping variable validation');
    }

    // 4. 校验 initvar_overrides 中所有 override 文件（复用同一 Schema 实例）
    if (state.initvar_overrides) {
      for (const [, overridePath] of Object.entries(state.initvar_overrides)) {
        const overrideResult = await validateMvuInitvar(
          stateDir, state.entryManifest, overridePath,
          schemaInstance ? { schemaPath: schemaAbsPath!, schema: schemaInstance } : undefined,
        );
        if (overrideResult) {
          console.log(`✓ MVU validation passed: ${overridePath}`);
        }
      }
    }
  }

  if (state.form === 'worldbook') {
    const json = buildWorldbookJson(state, stateDir, cardrc.depth_defaults);
    output ??= resolve(stateDir, `${state.worldbookName}.json`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, json);
    console.log(`Packed worldbook → ${output}`);
  } else {
    const hasAvatar = state.avatar && state.avatar.trim() !== '';
    const zodSubject = zodSync?.zodSubject;

    if (hasAvatar) {
      const png = buildCharacterPng(state, stateDir, cardrc.depth_defaults, zodSubject);
      output ??= resolve(stateDir, `${state.projectName}.png`);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, png);
      console.log(`Packed character (PNG) → ${output}`);
    } else {
      const json = buildCharacterJson(state, stateDir, cardrc.depth_defaults, zodSubject);
      output ??= resolve(stateDir, `${state.projectName}.json`);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, json);
      console.log(`Packed character (JSON) → ${output}`);
    }
  }
}
