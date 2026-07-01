import type { TavernCardsState } from '../type/state.js';

export function detectMvu(state: TavernCardsState): boolean {
  if (state.form !== 'charactercard') return false;

  const scripts = state.extensions?.tavern_helper?.scripts;
  const hasMvuScript = scripts && Object.values(scripts).some(script => {
    if (script.enabled === false) return false;
    const content = script.content ?? '';
    return content.includes('import') && content.includes('MagicalAstrogy/MagVarUpdate');
  });
  if (!hasMvuScript) return false;

  const hasInitVar = Object.values(state.entryManifest).some(typeEntries =>
    Object.keys(typeEntries).some(name => /^\[InitVar\]/i.test(name)),
  );
  if (!hasInitVar) return false;

  return true;
}
