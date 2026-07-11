import { join } from 'node:path';

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeFilename(name: string): string {
  let result = name.replace(ILLEGAL_CHARS, '_').trim();
  if (WINDOWS_RESERVED.test(result)) {
    result = '_' + result;
  }
  if (result.length > 200) {
    result = result.slice(0, 200);
  }
  return result;
}

/**
 * 生成不与 reservedPaths 冲突的相对路径；冲突时添加数字后缀
 *
 * 注意：reservedPaths 的 key 必须与此函数内部使用相同的路径格式（都走 node:path.join），
 * 不要混用手动字符串拼接，否则跨平台行为不一致。
 */
export function findAvailablePath(
  dir: string,
  stem: string,
  ext: string,
  reservedPaths: Set<string>,
): string {
  let relPath = join(dir, `${stem}${ext}`);
  if (!reservedPaths.has(relPath)) return relPath;

  let n = 1;
  do {
    relPath = join(dir, `${stem}_${n}${ext}`);
    n++;
  } while (reservedPaths.has(relPath));
  return relPath;
}
