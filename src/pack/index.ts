import { dirname, resolve } from 'node:path';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import { readFileText } from '../util/file_io.js';
import { validateAllFilePaths } from '../util/file_paths.js';
import { buildWorldbookJson, buildCharacterPng, buildCharacterJson } from './build.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolveProject, requireConfiguredProject } from '../cli/settings.js';
import { detectMvu, validateMvuEnabledState } from '../util/detect_mvu.js';
import {
  validateMvuInitvar,
  checkSchemaTsContent,
  isMvuZodScript,
  validateZodScriptContent,
  formatZodScriptValidationErrors,
  resolveSchemaSyncInput,
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

  // When mvu is declared, verify initvar entries & MVU script are actually present
  if (state.mvu) {
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

    // 1. 校验 Zod 脚本内容（检查会导致运行时失效的模式）
    // schema.ts 存在时：buildZodScriptFromSchemaTs 会移除 export type 并追加 register 块，
    //   但 schema.ts 自身的裸 import（import ... from 'zod' / 'lodash'）会被原样保留——
    //   这类裸模块标识符无法在浏览器中解析，必须拦截。用同步生成后的产物校验，复用同一检查逻辑。
    // schema.ts 不存在时：直接校验磁盘上的 脚本/Zod.txt 原样内容（typeExport 仍可能触发）。
    // resolveSchemaSyncInput 一次性完成读盘 + detect + build，避免重复读盘与重复 detect。
    const resolvedScripts = detectState.extensions?.tavern_helper?.scripts;
    const syncInput = resolveSchemaSyncInput(stateDir, resolvedScripts);
    const schemaTsContent = syncInput?.schemaContent;

    if (schemaTsContent) {
      const schemaImportErrors = checkSchemaTsContent(schemaTsContent);
      if (schemaImportErrors.length > 0) {
        throw new Error(schemaImportErrors.join('\n'));
      }
    }

    const zodSubject = syncInput?.zodSubject;

    if (resolvedScripts) {
      for (const [name, script] of Object.entries(resolvedScripts)) {
        if (script.enabled === false) continue;
        const content = script.content;
        if (!content || !isMvuZodScript(content)) continue;
        const subject = zodSubject ?? content;
        const issues = validateZodScriptContent(subject);
        const errors = formatZodScriptValidationErrors(
          issues,
          subject,
          zodSubject
            ? `"${name}" (generated from schema.ts)`
            : `"${name}" (scripts/${name}.txt on disk)`,
        );
        if (errors.length > 0) {
          throw new Error(errors.join('\n'));
        }
      }
    }

    // 2. 校验 MVU 条目和脚本的启用状态
    const enabledErrors = validateMvuEnabledState(state);
    if (enabledErrors.length > 0) {
      throw new Error('MVU enabled state validation failed:\n' + enabledErrors.map(e => `  - ${e}`).join('\n'));
    }

    // 3. 校验默认 initvar 与 schema.ts 一致性
    // 传入已读 schemaTsContent，避免 validateMvuInitvar 内部再次读盘/重复预检
    const result = await validateMvuInitvar(
      stateDir, state.entryManifest,
      undefined,
      schemaTsContent ? { schemaContent: schemaTsContent } : undefined,
    );
    if (result) {
      console.log(`✓ MVU validation passed: ${result.initvarPath} matches schema.ts`);
    } else {
      console.log('ℹ MVU project but schema.ts not found, skipping variable validation');
    }

    // 4. 校验 initvar_overrides 中所有 override 文件
    if (state.initvar_overrides) {
      for (const [greetingPath, overridePath] of Object.entries(state.initvar_overrides)) {
        const overrideResult = await validateMvuInitvar(
          stateDir, state.entryManifest, overridePath,
          schemaTsContent ? { schemaContent: schemaTsContent } : undefined,
        );
        // overrideResult 为 null 时 schema.ts 不存在，已在步骤 3 提示
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

    if (hasAvatar) {
      const png = buildCharacterPng(state, stateDir, cardrc.depth_defaults);
      output ??= resolve(stateDir, `${state.projectName}.png`);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, png);
      console.log(`Packed character (PNG) → ${output}`);
    } else {
      const json = buildCharacterJson(state, stateDir, cardrc.depth_defaults);
      output ??= resolve(stateDir, `${state.projectName}.json`);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, json);
      console.log(`Packed character (JSON) → ${output}`);
    }
  }
}
