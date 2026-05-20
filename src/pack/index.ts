import { dirname, resolve } from 'node:path';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import { readFileText } from '../util/file_io.js';
import { validateAllFilePaths } from '../util/file_paths.js';
import { buildWorldbookJson, buildCharacterPng, buildCharacterJson } from './build.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolveProject, requireConfiguredProject } from '../cli/settings.js';

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
