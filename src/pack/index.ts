import { dirname, resolve } from 'node:path';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import { readFileText } from '../util/file_io.js';
import { validateAllFilePaths } from '../util/file_paths.js';
import { buildWorldbookJson, buildCharacterPng, buildCharacterJson } from './build.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolveProject, requireConfiguredProject } from '../cli/settings.js';
import { detectMvu } from '../util/detect_mvu.js';

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
