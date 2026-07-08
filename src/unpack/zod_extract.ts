import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { TavernCardsState } from '../type/state.js';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { writeFileRecursive } from '../util/file_io.js';
import { isMvuZodScript, extractSchemaTsFromScript, detectMvuZodImportUrl, stripScriptDefaults } from '../util/mvu_schema.js';

const DIR_SCRIPTS = '脚本';

/**
 * 从角色卡 tavern_helper.scripts 中检测并提取 MVU Zod 脚本
 *
 * 提取后：
 * - schema.ts 写入 outputDir
 * - state.zod 填充描述符
 * - Zod 脚本从 scripts 中移除（后续脚本写入循环不再处理）
 * - 空 scripts / tavernHelper / extensions 自动清理
 */
export function detectAndExtractZodFromCard(state: TavernCardsState, outputDir: string): void {
  if (!state.mvu) return;

  const tavernHelper = state.extensions?.tavern_helper;
  if (!tavernHelper?.scripts || typeof tavernHelper.scripts !== 'object') return;

  for (const [scriptName, script] of Object.entries(tavernHelper.scripts)) {
    if (!script.enabled) continue;
    const content = script.content ?? '';
    if (!isMvuZodScript(content)) continue;

    // 找到第一个启用 Zod 脚本
    const schemaTs = extractSchemaTsFromScript(content);

    if (schemaTs === null) {
      // 压缩/编译脚本 → fallback，保留为普通脚本条目
      console.warn(`⚠ Zod script "${scriptName}" is compiled/minified; cannot auto-extract schema.ts`);
      break; // 只处理第一个
    }

    // 写入 schema.ts
    writeFileRecursive(resolve(outputDir, 'schema.ts'), schemaTs);
    console.log(`  Generated schema.ts (extracted from Zod script "${scriptName}")`);

    // 填充 state.zod
    state.zod = {
      scriptName,
      scriptId: script.id,
      schemaPath: 'schema.ts',
      importUrl: detectMvuZodImportUrl(content) ?? '',
      // 剥离 button/info/data 中等于 ST 默认值的字段，保持 state.zod 极简;
      // pack 时 buildZodScriptEntry 用 restoreScriptDefaults 恢复 ST 原生完整默认值
      ...stripScriptDefaults({ info: script.info, button: script.button, data: script.data }),
    };

    // 从 scripts 移除 Zod 脚本（不再写 脚本/{name}.txt，内容由 schema.ts + state.zod 管理）
    delete tavernHelper.scripts[scriptName];

    // 检查磁盘上是否有旧版本 unpack 留下的脚本文件，提示用户手动删除
    const scriptFileName = `${sanitizeFilename(scriptName)}.txt`;
    const scriptRelPath = join(DIR_SCRIPTS, scriptFileName);
    const scriptAbsPath = join(outputDir, scriptRelPath);
    if (existsSync(scriptAbsPath)) {
      console.log(`  ⚠ Zod script local file "${scriptRelPath}" is no longer needed (now managed by schema.ts + state.zod) — may be removed manually`);
    }

    console.log(`  Filled state.zod (scriptName="${scriptName}", importUrl="${state.zod.importUrl}")`);
    break; // 多个启用 Zod 脚本仅处理第一个
  }

  // 清理空 scripts
  if (tavernHelper.scripts && Object.keys(tavernHelper.scripts).length === 0) {
    delete tavernHelper.scripts;
  }
  // 清理空 tavernHelper
  if (Object.keys(tavernHelper).length === 0) {
    delete state.extensions!.tavern_helper;
  }
  // 清理空 extensions
  if (state.extensions && Object.keys(state.extensions).length === 0) {
    delete state.extensions;
  }
}
