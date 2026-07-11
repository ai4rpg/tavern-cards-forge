import { resolve } from 'node:path';
import { readFileText } from '../util/file_io.js';
import { TavernCardsState as TavernCardsStateSchema } from '../type/state.js';
import type { TavernCardsState, EntryManifestLeaf, EntryManifest, ZodDescriptor } from '../type/state.js';

/**
 * Unpack merge 逻辑：将新提取的角色卡数据与已有 state.json 合并
 *
 * 合并策略：
 * - 角色卡侧字段（description, first_messages, extensions 等）取新值（角色卡数据为本）
 * - 状态侧字段（path, scope, part, rephrase, abstract 等）保留旧值（本地维护）
 * - 分类结构（typeLists, strategyThresholds, partOrder）保留旧值
 */

/** 读取并校验旧 state.json；校验失败时 warn 并回退到裸 JSON（不阻塞 unpack） */
export function readAndValidateOldState(path: string): TavernCardsState {
  const raw = JSON.parse(readFileText(path)) as Record<string, unknown>;
  const result = TavernCardsStateSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.warn(
      `⚠ Existing state.json validation failed, merge may be incomplete:\n${issues}\n  Fix ${path} and re-run unpack`,
    );
    return {
      ...raw,
      entryManifest: (raw.entryManifest ?? {}) as EntryManifest,
    } as TavernCardsState;
  }
  return result.data;
}

/** 合并单个条目：角色卡侧字段取新值，状态侧字段保留旧值 */
function mergeLeaf(newLeaf: EntryManifestLeaf, oldLeaf: EntryManifestLeaf): EntryManifestLeaf {
  return {
    ...newLeaf,
    // --- 状态侧字段：保留旧 leaf ---
    path: oldLeaf.path,
    contents: oldLeaf.contents,
    scope: oldLeaf.scope,
    part: oldLeaf.part,
    rephrase: oldLeaf.rephrase,
    // abstract 是必填字段：保留旧值（新值来自解析器，始终为空串）
    abstract: oldLeaf.abstract ?? '',
  };
}

/** 获取条目的正文内容文本（优先读 contents 内联，其次读 path 文件） */
function getEntryText(leaf: EntryManifestLeaf, baseDir?: string): string {
  if (leaf.contents && leaf.contents.length > 0) {
    return leaf.contents.map(f => f.content ?? '').join('');
  }
  if (leaf.path && baseDir) {
    try {
      return readFileText(resolve(baseDir, leaf.path));
    } catch {
      return '';
    }
  }
  return '';
}

export interface MergeResult {
  state: TavernCardsState;
  /** 未匹配旧条目的文件路径集合（用于写入时避让冲突） */
  reservedPaths: Set<string>;
}

export function mergeWithExistingState(
  newState: TavernCardsState,
  oldState: TavernCardsState,
  oldStateDir?: string,
  newContentLookup?: Map<string, string>,
): MergeResult {
  // 构建旧条目查找索引
  const nameIndex = new Map<string, { typeName: string; entryName: string; leaf: EntryManifestLeaf }>();

  for (const [typeName, entries] of Object.entries(oldState.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(entries)) {
      nameIndex.set(entryName, { typeName, entryName, leaf });
    }
  }

  // 新 state 的 entryManifest 和全部叶子
  // 注意：flatEntriesToState / rawEntriesToState 产出所有条目均归入 unknown 类别，
  // 因此此处只取 unknown。若未来解析器产出真实分类，需改为遍历所有类别。
  const newLeaves = Object.entries(newState.entryManifest.unknown ?? {});

  // 旧分类结构保留，但先清空所有叶子（后面按匹配结果重新填充）
  const mergedManifest: EntryManifest = {};
  for (const typeName of Object.keys(oldState.entryManifest)) {
    mergedManifest[typeName] = {};
  }
  // 确保 unknown 始终存在（用于新增条目）
  if (!mergedManifest.unknown) mergedManifest.unknown = {};

  // 新条目的 oldNames 集合（用于检测删除）
  const matchedOldNames = new Set<string>();

  // 跟踪尚未被匹配的旧条目（用于第二轮内容匹配）
  const unmatchedOld = new Map<string, { typeName: string; entryName: string; leaf: EntryManifestLeaf }>();

  // --- 第一轮：comment（条目名）匹配 ---
  const matchedNewEntries = new Set<number>(); // indices into newLeaves that were matched

  for (let i = 0; i < newLeaves.length; i++) {
    const [entryName, newLeaf] = newLeaves[i];
    const match = nameIndex.get(entryName);

    if (match) {
      const merged = mergeLeaf(newLeaf, match.leaf);
      mergedManifest[match.typeName][entryName] = merged;
      matchedOldNames.add(match.entryName);
      matchedNewEntries.add(i);
    }
  }

  // 收集未匹配的旧条目用于第二轮
  for (const [name, entry] of nameIndex) {
    if (!matchedOldNames.has(name)) {
      unmatchedOld.set(name, entry);
    }
  }

  // --- 第二轮：内容匹配兜底 ---
  // 对名称匹配未命中的新条目，比较归一化后的内容以检测重命名。
  // 预建缓存避免 N×M 次同步 IO，归一化保留语义（仅统一换行/折叠空白，不删除空白）。
  const normalizeContent = (c: string): string =>
    c.replace(/\r\n?/g, '\n')
     .replace(/[ \t]+/g, ' ')
     .replace(/\n{2,}/g, '\n')
     .trim();

  // 预读所有旧条目内容（一次性 IO，后续只做字符串比较）
  const oldContentCache = new Map<string, string>();
  for (const [oldName, oldEntry] of unmatchedOld) {
    const text = getEntryText(oldEntry.leaf, oldStateDir);
    if (text) oldContentCache.set(oldName, normalizeContent(text));
  }

  // 预归一化新条目内容（newContentLookup 已有内容，归一化后缓存）
  const newContentCache = new Map<string, string>();
  for (let i = 0; i < newLeaves.length; i++) {
    if (matchedNewEntries.has(i)) continue;
    const [entryName] = newLeaves[i];
    const raw = newContentLookup?.get(entryName) ?? '';
    if (raw) newContentCache.set(entryName, normalizeContent(raw));
  }

  for (let i = 0; i < newLeaves.length; i++) {
    if (matchedNewEntries.has(i)) continue;

    const [entryName, newLeaf] = newLeaves[i];
    const newContent = newContentCache.get(entryName);

    let contentMatch: { typeName: string; entryName: string; leaf: EntryManifestLeaf } | undefined;
    for (const [oldName, oldEntry] of unmatchedOld) {
      const oldContent = oldContentCache.get(oldName);
      if (newContent && oldContent && newContent === oldContent) {
        contentMatch = oldEntry;
        unmatchedOld.delete(oldName);
        break;
      }
    }

    if (contentMatch) {
      const merged = mergeLeaf(newLeaf, contentMatch.leaf);
      mergedManifest[contentMatch.typeName][entryName] = merged;
      matchedOldNames.add(contentMatch.entryName);
      console.log(`  ↻ Entry renamed: "${contentMatch.entryName}" → "${entryName}" [${contentMatch.typeName}] (matched by content)`);
    } else {
      // 未匹配的新条目 → unknown
      mergedManifest.unknown[entryName] = newLeaf;
    }
  }

  // 清理空类别
  for (const typeName of Object.keys(mergedManifest)) {
    if (Object.keys(mergedManifest[typeName]).length === 0) {
      delete mergedManifest[typeName];
    }
  }

  // zod merge：角色卡数据优先（scriptId/importUrl 等可能更新），schemaPath 优先取旧值（用户可能手动调整）
  let zod: ZodDescriptor | undefined;
  if (newState.zod) {
    zod = { ...newState.zod, schemaPath: oldState.zod?.schemaPath ?? newState.zod.schemaPath };
  } else if (oldState.zod) {
    console.warn('⚠ New card has no Zod script but old state.zod exists; descriptor preserved — will rebuild on pack');
    zod = oldState.zod;
  }

  // 构建 merge 后的 state
  const merged: TavernCardsState = {
    // 新角色卡元数据
    projectName: newState.projectName,
    worldbookName: newState.worldbookName,
    form: newState.form,
    description: newState.description,
    first_messages: newState.first_messages,
    creator: newState.creator,
    creator_notes: newState.creator_notes,
    version: newState.version,
    create_date: newState.create_date,
    extensions: newState.extensions,
    regex_scripts: newState.regex_scripts,
    depth_defaults: newState.depth_defaults,
    // 保留旧 state 的分类结构数据
    entryManifest: mergedManifest,
    typeLists: oldState.typeLists,
    strategyThresholds: oldState.strategyThresholds,
    partOrder: oldState.partOrder,
    mvu: oldState.mvu,
    // avatar 用新的
    avatar: newState.avatar,
    zod,
  };

  // 收集未匹配旧条目的文件路径（本地文件保留，由调用方汇总输出）
  const reservedPaths = new Set<string>();
  for (const [typeName, entries] of Object.entries(oldState.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(entries)) {
      if (!matchedOldNames.has(entryName)) {
        if (leaf.path) reservedPaths.add(leaf.path);
        if (leaf.contents) {
          for (const frag of leaf.contents) {
            if (frag.file) reservedPaths.add(frag.file);
          }
        }
      }
    }
  }

  return { state: merged, reservedPaths };
}
