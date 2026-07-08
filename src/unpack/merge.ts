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

export function mergeWithExistingState(
  newState: TavernCardsState,
  oldState: TavernCardsState,
): TavernCardsState {
  // 构建旧条目查找索引：{uid → {typeName, entryName, leaf}, ...}
  const uidIndex = new Map<number, { typeName: string; entryName: string; leaf: EntryManifestLeaf }>();
  const nameIndex = new Map<string, { typeName: string; entryName: string; leaf: EntryManifestLeaf }>();

  for (const [typeName, entries] of Object.entries(oldState.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(entries)) {
      if (leaf.uid !== undefined) uidIndex.set(leaf.uid, { typeName, entryName, leaf });
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

  // 遍历新条目进行匹配
  for (const [entryName, newLeaf] of newLeaves) {
    const newUid = newLeaf.uid;

    // 1. uid 匹配
    let match = newUid !== undefined ? uidIndex.get(newUid) : undefined;
    // 2. comment（条目名）匹配
    if (!match) match = nameIndex.get(entryName);

    if (match) {
      // 条目匹配成功：保留旧 typeName，按「角色卡侧/状态侧」分字段 merge。
      // 角色卡侧字段来自 newLeaf（角色卡数据为本，覆盖本地配置）；
      // 状态侧字段保留旧值（它们是 forge/用户在本地维护、不在角色卡中体现的存储结构信息）。
      const merged: EntryManifestLeaf = {
        ...newLeaf,
        // --- 状态侧字段：保留旧 leaf ---
        path: match.leaf.path,
        contents: match.leaf.contents,
        scope: match.leaf.scope,
        part: match.leaf.part,
        rephrase: match.leaf.rephrase,
        // abstract 是必填字段：保留旧值，仅在旧值缺失时回退到新值，最终兜底空串
        abstract: match.leaf.abstract ?? newLeaf.abstract ?? '',
      };

      mergedManifest[match.typeName][entryName] = merged;
      matchedOldNames.add(match.entryName);
    } else {
      // 新增条目 → unknown
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

  // 提示在新角色卡中被移除的旧条目（本地文件仍保留，用户需自行决定删除或重新注册）
  for (const [typeName, entries] of Object.entries(oldState.entryManifest)) {
    for (const [entryName, leaf] of Object.entries(entries)) {
      if (!matchedOldNames.has(entryName)) {
        const fileInfo = leaf.path ? ` (file: ${leaf.path})` : '';
        console.log(`  ⚠ Entry "${entryName}" [${typeName}] removed from card${fileInfo} — local file preserved`);
      }
    }
  }

  return merged;
}
