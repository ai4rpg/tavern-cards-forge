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

/**
 * 校验 MVU 条目的启用状态
 * - [InitVar] 条目必须禁用（enabled: false；缺省时 SillyTavern 默认启用，视为违规）
 *
 * MVU 相关脚本的启用状态由 detectMvu 的启用脚本过滤隐式保证：
 * 若 MVU/Zod 脚本被禁用，detectMvu 返回 false → pack 报错。
 *
 * @returns 违规项列表；空数组表示通过
 */
export function validateMvuEnabledState(state: TavernCardsState): string[] {
  const errors: string[] = [];

  // [InitVar] 条目必须禁用
  for (const typeEntries of Object.values(state.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(typeEntries)) {
      if (/^\[InitVar\]/i.test(entryName) && leaf.enabled !== false) {
        errors.push(`Entry "${entryName}" must be disabled (enabled: false), currently ${leaf.enabled === undefined ? 'undefined (SillyTavern default: enabled)' : String(leaf.enabled)}`);
      }
    }
  }

  return errors;
}
