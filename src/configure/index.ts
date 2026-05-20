import { resolve } from 'node:path';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import { readFileText, writeJson, sortEntriesForSerialization } from '../util/file_io.js';
import { configureState } from './generator.js';
import { validateState } from './validate.js';
import { resolveProject } from '../cli/settings.js';

export async function runConfigure(project: string, opts: { state?: string; force?: boolean }) {
  const { statePath } = resolveProject(project, opts);

  const stateRaw = JSON.parse(readFileText(statePath));
  const state = detailedParse(TavernCardsState, stateRaw);

  const validateResult = validateState(state);
  if (validateResult.errors.length > 0) {
    throw new Error('Validation FAILED:\n' + validateResult.errors.map(e => `  - ${e}`).join('\n'));
  }

  const configured = configureState(state, opts.force);

  writeJson(statePath, sortEntriesForSerialization(configured));
  console.log(`Configured → ${statePath}`);
}
