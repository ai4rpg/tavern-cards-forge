import { buildSillyTavernCharacter, buildFlatWorldbook } from './to_raw.js';
import { resolveFiles } from './resolve_files.js';
import { writePng } from './png_encode.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { TavernCardsState } from '../type/state.js';
import type { CardrcConfig } from '../type/settings.js';
import { readFileText } from '../util/file_io.js';
import { isMvuZodScript, embedInitvarOverrideInGreeting, resolveSchemaSyncInput } from '../util/mvu_schema.js';

function resolveInlineOrFile(value: string, stateDir: string): string {
  if (!value.includes('\n') && value.match(/\.(txt|md|json|yaml|yml|html)$/)) {
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

function resolvePackState(state: TavernCardsState, stateDir: string): TavernCardsState {
  const packState = { ...state };

  // --- first_messages: 解析文件 + MVU initvar_override 嵌入 ---
  packState.first_messages = state.first_messages.map((item, index) => {
    const resolved = resolveInlineOrFile(item, stateDir);

    // MVU: 嵌入 initvar_override
    if (state.initvar_overrides) {
      const greetingKey = state.first_messages[index]; // 原始值，如 "开场白/1.txt"
      // 只有当 greetingKey 是文件路径（非内联文本）时才查找 override
      if (greetingKey.includes('\n') || !greetingKey.match(/\.(txt|md|json|yaml|yml|html)$/)) {
        return resolved;
      }
      const overridePath = state.initvar_overrides[greetingKey];
      if (overridePath) {
        const overrideAbsPath = resolve(stateDir, overridePath);
        const initvarYaml = readFileText(overrideAbsPath);
        return embedInitvarOverrideInGreeting(resolved, initvarYaml);
      }
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

  // --- tavern_helper.scripts: 解析 script_file + MVU Zod 脚本同步 ---
  const tavernHelper = state.extensions?.tavern_helper;
  if (tavernHelper?.scripts) {
    const resolvedScripts: Record<string, any> = {};

    // schema.ts 存在时一次性读盘 + detect import URL，避免循环内重复读盘
    const syncInput = resolveSchemaSyncInput(stateDir, tavernHelper.scripts, (script) =>
      script.script_file
        ? readFileText(resolve(stateDir, script.script_file))
        : script.content,
    );

    for (const [name, script] of Object.entries(tavernHelper.scripts)) {
      if (script.script_file) {
        const content = resolveFilePath(script.script_file, stateDir);
        const { script_file, ...rest } = script;

        // MVU: schema.ts 存在时，同步启用的 Zod 脚本（复用 syncInput.zodSubject，避免重复 build）
        if (syncInput && rest.enabled !== false && content && isMvuZodScript(content)) {
          resolvedScripts[name] = { ...rest, content: syncInput.zodSubject };
          console.log(`✓ Zod script "${name}" synced from schema.ts`);
        } else if (content) {
          resolvedScripts[name] = { ...rest, content };
        }
      } else if (script.content) {
        // content 已内联：schema.ts 存在时同步，否则原样传递
        if (syncInput && script.enabled !== false && isMvuZodScript(script.content)) {
          resolvedScripts[name] = { ...script, content: syncInput.zodSubject };
          console.log(`✓ Zod script "${name}" synced from schema.ts`);
        } else {
          resolvedScripts[name] = script;
        }
      }
    }

    if (Object.keys(resolvedScripts).length > 0) {
      packState.extensions = { ...state.extensions };
      packState.extensions.tavern_helper = {
        ...tavernHelper,
        scripts: resolvedScripts,
      };
    }
  }

  return packState;
}

export function buildWorldbookJson(state: TavernCardsState, stateDir: string, depthDefaults?: CardrcConfig['depth_defaults']): string {
  const resolved = resolveFiles(state, stateDir);
  const raw = buildFlatWorldbook(resolved, state.worldbookName);
  return JSON.stringify(raw, null, 2);
}

export function buildCharacterJson(state: TavernCardsState, stateDir: string, depthDefaults?: CardrcConfig['depth_defaults']): string {
  const resolved = resolveFiles(state, stateDir);
  const packState = resolvePackState(state, stateDir);
  const rawChar = buildSillyTavernCharacter(packState, resolved, depthDefaults);
  return JSON.stringify(rawChar, null, 2);
}

export function buildCharacterPng(state: TavernCardsState, stateDir: string, depthDefaults?: CardrcConfig['depth_defaults']): Buffer {
  const resolved = resolveFiles(state, stateDir);
  const packState = resolvePackState(state, stateDir);
  const rawChar = buildSillyTavernCharacter(packState, resolved, depthDefaults);
  const jsonStr = JSON.stringify(rawChar);

  if (!state.avatar) {
    throw new Error('Cannot build PNG without avatar. Use buildCharacterJson instead.');
  }

  const avatarPath = resolve(stateDir, state.avatar);
  const avatar = readFileSync(avatarPath);

  return writePng(avatar, jsonStr);
}
