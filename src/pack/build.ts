import { buildSillyTavernCharacter, buildFlatWorldbook } from './to_raw.js';
import { resolveFiles } from './resolve_files.js';
import { writePng } from './png_encode.js';
import { resolve, extname } from 'node:path';
import { readFileSync } from 'node:fs';
import type { TavernCardsState } from '../type/state.js';
import type { CardrcConfig } from '../type/settings.js';
import { readFileText } from '../util/file_io.js';
import { embedInitvarOverrideInGreeting, prepareZodSync, buildZodScriptEntry, isFilePathGreeting, appendStatusPlaceholderIfMissing } from '../util/mvu_schema.js';

function resolveInlineOrFile(value: string, stateDir: string): string {
  if (isFilePathGreeting(value)) {
    const absPath = resolve(stateDir, value);
    try {
      return readFileText(absPath);
    } catch {
      return value;
    }
  }
  return value;
}

function resolveFilePath(value: string, stateDir: string): string {
  const absPath = resolve(stateDir, value);
  return readFileText(absPath);
}

function resolvePackState(state: TavernCardsState, stateDir: string, zodSubject?: string): TavernCardsState {
  const packState = { ...state };

  // --- first_messages: 解析文件 + MVU initvar_override 嵌入 + 状态栏占位符追加 ---
  packState.first_messages = state.first_messages.map((item, index) => {
    const greetingKey = state.first_messages[index]; // 原始值，如 "开场白/1.txt"
    let resolved = resolveInlineOrFile(item, stateDir);

    // MVU: 嵌入 initvar_override（仅文件路径条目）
    if (state.initvar_overrides && isFilePathGreeting(greetingKey)) {
      const overridePath = state.initvar_overrides[greetingKey];
      if (overridePath) {
        const overrideAbsPath = resolve(stateDir, overridePath);
        const initvarYaml = readFileText(overrideAbsPath);
        resolved = embedInitvarOverrideInGreeting(resolved, initvarYaml);
      }
    }

    // MVU: 向 .txt 开场白末尾追加状态栏占位符（幂等，在 initvar 嵌入之后执行，落在最末尾）
    if (state.mvu && isFilePathGreeting(greetingKey) && extname(greetingKey).toLowerCase() === '.txt') {
      resolved = appendStatusPlaceholderIfMissing(resolved);
    }

    return resolved;
  });

  if (state.regex_scripts) {
    packState.regex_scripts = Object.fromEntries(
      Object.entries(state.regex_scripts).map(([name, script]) => {
        if (script.replace_file) {
          const content = resolveFilePath(script.replace_file, stateDir);
          const { replace_file, ...rest } = script;
          return [name, { ...rest, replaceString: content }];
        }
        return [name, script];
      }),
    );
  }

  // --- tavern_helper.scripts: 解析 script_file + state.zod 重建 ---
  const tavernHelper = state.extensions?.tavern_helper;

  // 解析普通脚本的 script_file → content（zod 与非 zod 分支共用）
  const resolveScripts = (src: Record<string, any>): Record<string, any> => {
    const resolved: Record<string, any> = {};
    for (const [name, script] of Object.entries(src)) {
      if (script.script_file) {
        const content = resolveFilePath(script.script_file, stateDir);
        const { script_file, ...rest } = script;
        if (content) resolved[name] = { ...rest, content };
      } else if (script.content) {
        resolved[name] = script;
      }
    }
    return resolved;
  };

  if (state.zod) {
    // Zod 脚本: 从 schemaPath 重建（zodSubject 由调用方通过 prepareZodSync 预计算注入，避免重复读盘）
    const resolvedZodSubject = zodSubject ?? prepareZodSync(stateDir, state.zod).zodSubject;
    const scripts = resolveScripts(tavernHelper?.scripts ?? {});
    if (scripts[state.zod.scriptName]) {
      console.warn(
        `⚠ tavern_helper.scripts already has a script named "${state.zod.scriptName}", ` +
        `overwritten by state.zod rebuild; consider re-running unpack to clean up redundant script entries`
      );
    }
    scripts[state.zod.scriptName] = buildZodScriptEntry(state.zod, resolvedZodSubject);
    console.log(`✓ Zod script "${state.zod.scriptName}" rebuilt from ${state.zod.schemaPath}`);

    if (Object.keys(scripts).length > 0) {
      packState.extensions = { ...state.extensions };
      packState.extensions.tavern_helper = { ...tavernHelper, scripts };
    }
  } else if (tavernHelper?.scripts) {
    const resolvedScripts = resolveScripts(tavernHelper.scripts);
    if (Object.keys(resolvedScripts).length > 0) {
      packState.extensions = { ...state.extensions };
      packState.extensions.tavern_helper = { ...tavernHelper, scripts: resolvedScripts };
    }
  }

  return packState;
}

export function buildWorldbookJson(state: TavernCardsState, stateDir: string): string {
  const resolved = resolveFiles(state, stateDir);
  const raw = buildFlatWorldbook(resolved);
  return JSON.stringify(raw, null, 2);
}

function buildRawCharacter(
  state: TavernCardsState, stateDir: string,
  depthDefaults?: CardrcConfig['depth_defaults'], zodSubject?: string,
) {
  const resolved = resolveFiles(state, stateDir);
  const packState = resolvePackState(state, stateDir, zodSubject);
  return buildSillyTavernCharacter(packState, resolved, depthDefaults);
}

export function buildCharacterJson(state: TavernCardsState, stateDir: string, depthDefaults?: CardrcConfig['depth_defaults'], zodSubject?: string): string {
  return JSON.stringify(buildRawCharacter(state, stateDir, depthDefaults, zodSubject), null, 2);
}

export function buildCharacterPng(state: TavernCardsState, stateDir: string, depthDefaults?: CardrcConfig['depth_defaults'], zodSubject?: string): Buffer {
  const jsonStr = JSON.stringify(buildRawCharacter(state, stateDir, depthDefaults, zodSubject));

  if (!state.avatar) {
    throw new Error('Cannot build PNG without avatar. Use buildCharacterJson instead.');
  }

  const avatarPath = resolve(stateDir, state.avatar);
  const avatar = readFileSync(avatarPath);

  return writePng(avatar, jsonStr);
}
