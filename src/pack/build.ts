import { buildSillyTavernCharacter, buildFlatWorldbook } from './to_raw.js';
import { resolveFiles } from './resolve_files.js';
import { writePng } from './png_encode.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { TavernCardsState } from '../type/state.js';
import type { CardrcConfig } from '../type/settings.js';
import { readFileText } from '../util/file_io.js';

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

  packState.first_messages = state.first_messages.map(item => resolveInlineOrFile(item, stateDir));

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

  const tavernHelper = state.extensions?.tavern_helper;
  if (tavernHelper?.scripts) {
    const resolvedScripts: Record<string, any> = {};
    for (const [name, script] of Object.entries(tavernHelper.scripts)) {
      if (script.script_file) {
        const content = resolveFilePath(script.script_file, stateDir);
        const { script_file, ...rest } = script;
        if (content) resolvedScripts[name] = { ...rest, content };
      } else if (script.content) {
        resolvedScripts[name] = script;
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
