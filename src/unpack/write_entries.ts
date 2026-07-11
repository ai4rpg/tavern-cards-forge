import { resolve, dirname, basename, extname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { analyzeEntryYamlContent, buildWrappedYamlContents } from './split_xml.js';
import { sanitizeFilename, findAvailablePath } from '../util/sanitize_filename.js';
import { writeJson, writeFileRecursive, sortEntriesForSerialization } from '../util/file_io.js';
import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';

const DIR_ENTRIES = '世界书';

/**
 * 条目写入逻辑：将 entry content 写入磁盘文件或 contents 片段
 *
 * @param leaf 条目 manifest leaf（会被就地修改 path/contents）
 * @param entryName 条目名（manifest key，可能含特殊字符）
 * @param body 条目原始内容
 * @param outputDir 输出目录绝对路径
 * @param preserve merge 模式下保留的旧存储格式；提供时尊重旧路径/片段结构
 * @param reservedPaths 已占用的相对路径集合（写入后自动登记，防止后续条目撞名）
 */

export function writeEntryBody(
  leaf: EntryManifestLeaf,
  entryName: string,
  body: string,
  outputDir: string,
  reservedPaths: Set<string>,
  preserve?: { path?: string; contents?: Array<{ content?: string; file?: string }> },
): void {
  const analysis = analyzeEntryYamlContent(body);

  // --- merge 模式：保留旧路径/片段结构 ---
  if (preserve?.path) {
    // 旧条目是单文件存储：保留目录和文件名主体，仅调整后缀
    const oldDir = dirname(preserve.path);
    const oldStem = basename(preserve.path, extname(preserve.path));
    const newExt = (analysis.kind === 'not_yaml') ? '.txt' : '.yaml';
    const relPath = join(oldDir, `${oldStem}${newExt}`);
    const absPath = join(outputDir, relPath);

    writeFileRecursive(absPath, body);
    delete leaf.contents;
    leaf.path = relPath;
    reservedPaths.add(relPath);

    // 检测扩展名变更（如 .txt → .yaml）
    if (preserve.path !== relPath) {
      console.log(`  ⚠ Entry "${entryName}" extension changed: ${preserve.path} → ${relPath} — old file may be removed manually`);
    }
    return;
  }

  if (preserve?.contents) {
    // 旧条目是 wrapped_yaml 片段存储
    if (analysis.kind === 'wrapped_yaml') {
      // 新内容仍是 wrapped_yaml：保留旧片段结构，更新内容和路径后缀
      delete leaf.path;
      leaf.contents = buildWrappedYamlContents(analysis, entryName, DIR_ENTRIES, outputDir, reservedPaths, preserve.contents);
      // 登记 wrapped_yaml 所有片段路径
      for (const frag of leaf.contents) {
        if (frag.file) reservedPaths.add(frag.file);
      }
      return;
    }

    // 新内容不再被识别为 wrapped_yaml（可能因 {{}} 模板语法导致 YAML 解析失败），
    // 但旧条目用户已选择片段存储格式，应尽量保留：
    // - 保留旧 file 片段的目录和文件名主体，仅调后缀
    // - 将完整内容写入该文件（而非拆分片段），更新 leaf.path
    // - 旧片段文件可能残留，输出警告让用户手动清理
    const firstFile = preserve.contents.find(f => f.file);
    const relPath = firstFile?.file
      ? join(dirname(firstFile.file), `${basename(firstFile.file, extname(firstFile.file))}.txt`)
      : join(DIR_ENTRIES, `${sanitizeFilename(entryName)}.txt`);
    const absPath = join(outputDir, relPath);

    writeFileRecursive(absPath, body);
    delete leaf.contents;
    leaf.path = relPath;
    reservedPaths.add(relPath);
    console.log(`  ⚠ Entry "${entryName}" storage changed: contents fragments → ${relPath} — old fragment files may be removed manually`);
    return;
  }

  // --- fresh 模式 / 新增条目：完整自动判定逻辑 ---
  if (analysis.kind === 'plain_yaml') {
    const relPath = findAvailablePath(DIR_ENTRIES, sanitizeFilename(entryName), '.yaml', reservedPaths);
    const absPath = join(outputDir, relPath);

    writeFileRecursive(absPath, body);
    delete leaf.contents;
    leaf.path = relPath;
    reservedPaths.add(relPath);
    return;
  }

  if (analysis.kind === 'wrapped_yaml') {
    delete leaf.path;
    leaf.contents = buildWrappedYamlContents(analysis, entryName, DIR_ENTRIES, outputDir, reservedPaths);
    // 登记 wrapped_yaml 所有片段路径
    for (const frag of leaf.contents) {
      if (frag.file) reservedPaths.add(frag.file);
    }
    return;
  }

  // not_yaml 兜底：写入 .txt 单文件
  const relPath = findAvailablePath(DIR_ENTRIES, sanitizeFilename(entryName), '.txt', reservedPaths);
  const absPath = join(outputDir, relPath);

  writeFileRecursive(absPath, body);
  delete leaf.contents;
  leaf.path = relPath;
  reservedPaths.add(relPath);
}

/** 内容查找表：按条目名查找 raw 内容 */
export type ContentLookup = Map<string, string>;

/** 从 raw 条目数组构建内容查找表（comment → content） */
export function buildContentLookup(entries: readonly { comment?: string; content?: string }[]): ContentLookup {
  const lookup: ContentLookup = new Map();
  for (const entry of entries) {
    const content = entry.content ?? '';
    if (entry.comment) lookup.set(entry.comment, content);
  }
  return lookup;
}

export function writeStateWithEntries(
  state: TavernCardsState,
  contentLookup: ContentLookup,
  outputDir: string,
  reservedPaths: Set<string>,
) {
  mkdirSync(outputDir, { recursive: true });

  const entriesDir = join(outputDir, DIR_ENTRIES);
  mkdirSync(entriesDir, { recursive: true });

  // 按 entryName 排序，保证 findAvailablePath 后缀分配稳定（不受对象 key 顺序影响）
  const allLeaves = Object.values(state.entryManifest)
    .flatMap(e => Object.entries(e))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [entryName, leaf] of allLeaves) {
    const content = contentLookup.get(entryName) ?? '';
    if (!content) {
      if (!leaf.path && !leaf.contents) {
        delete leaf.contents;
        leaf.path = '';
      }
      continue;
    }

    // merge 后 leaf 可能已有旧 path/contents，传入 preserve 让 writeEntryBody 保留旧结构
    const preserve = (leaf.path || leaf.contents) ? { path: leaf.path, contents: leaf.contents } : undefined;
    writeEntryBody(leaf, entryName, content, outputDir, reservedPaths, preserve);
  }

  writeJson(resolve(outputDir, 'tavern-cards-state.json'), sortEntriesForSerialization(state));
}
