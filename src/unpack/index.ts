import { detectFileType, extractFromPng, readWorldbookJson } from './extract.js';
import { rawEntriesToState } from './parse_raw.js';
import { flatEntriesToState } from './parse_flat_worldbook.js';
import { buildCharacterMeta, isFlatWorldbookFormat, isCharacterCardJson } from './from_sillytavern.js';
import { readAndValidateOldState, mergeWithExistingState } from './merge.js';
import { detectAndExtractZodFromCard } from './zod_extract.js';
import { buildContentLookup, writeStateWithEntries } from './write_entries.js';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { writeJson, writeFileRecursive } from '../util/file_io.js';
import { resolve, dirname, basename, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import type { SillyTavernEntry, FlatWorldbookEntry } from '../type/sillytavern.js';
import { resolveProject, ProjectNotFoundError } from '../cli/settings.js';
import { stripCharaChunks } from '../pack/png_encode.js';
import { detectMvu } from '../util/detect_mvu.js';
import { isMvuZodScript, extractInitvarOverrideFromGreeting, STATUS_PLACEHOLDER } from '../util/mvu_schema.js';

const DIR_REGEX = '正则';
const DIR_SCRIPTS = '脚本';
const DIR_GREETINGS = '开场白';

export async function runUnpack(
  project: string,
  opts: { file?: string; output?: string; state?: string; json?: boolean; fresh?: boolean },
) {
  const { artifactPath, statePath, projectFound } = resolveProject(project, { artifact: opts.file });
  if (!projectFound) {
    const missing: string[] = [];
    if (!opts.file) missing.push('--file');
    if (!opts.state && !opts.fresh) missing.push('--state or --fresh');
    // merge 模式: --output 可从 --state 推导（dirname）；fresh 模式: --output 必须显式指定
    if (!opts.output && opts.fresh) missing.push('--output');
    if (missing.length > 0) {
      throw new Error(`Without a configured project, ${missing.join(', ')} are required.`);
    }
  }

  if (!artifactPath) {
    throw new ProjectNotFoundError(project, 'Provide --file to specify input.');
  }

  const cwd = process.cwd();
  let filePath: string;
  let outputDir = opts.output;

  // merge 模式下 --output 未指定时，从 --state 路径推导（state.json 所在目录即 output 目录）
  if (!outputDir && opts.state) {
    outputDir = dirname(resolve(cwd, opts.state));
  }

  if (opts.file) {
    filePath = resolve(cwd, opts.file);
  } else {
    filePath = artifactPath!;
    if (!outputDir) {
      outputDir = dirname(statePath);
    }
  }

  if (!outputDir) {
    outputDir = resolve(cwd, basename(filePath).replace(/\.(png|json)$/i, ''));
  }
  outputDir = resolve(cwd, outputDir);

  const fileType = detectFileType(filePath);

  if (opts.json) {
    if (fileType !== 'png') {
      throw new Error('--json only supports PNG input. JSON files are already in text form.');
    }
    const { data } = extractFromPng(filePath);
    const outPath = opts.output ?? resolve(cwd, basename(filePath, '.png') + '.json');
    writeJson(outPath, data);
    console.log(`JSON output → ${outPath}`);
    return;
  }

  let rawEntries: SillyTavernEntry[];
  let form: 'charactercard' | 'worldbook';
  let characterMeta: Record<string, any> | null = null;
  let name: string;
  let worldbookName: string;
  let avatarBuffer: Buffer | null = null;

  if (fileType === 'png') {
    const extracted = extractFromPng(filePath);
    const data = extracted.data;
    avatarBuffer = extracted.imageBuffer;
    name = data.name ?? data.data?.name ?? basename(filePath, '.png');
    worldbookName = data.data?.character_book?.name ?? name;
    form = 'charactercard';

    if (data.data?.character_book?.entries) {
      rawEntries = data.data.character_book.entries;
    } else {
      rawEntries = [];
    }

    characterMeta = buildCharacterMeta(data);
  } else {
    const { data } = readWorldbookJson(filePath);

    if (isCharacterCardJson(data)) {
      name = data.name ?? data.data?.name ?? basename(filePath, '.json');
      worldbookName = data.data?.character_book?.name ?? name;
      form = 'charactercard';

      if (data.data?.character_book?.entries) {
        rawEntries = data.data.character_book.entries;
      } else {
        rawEntries = [];
      }

      characterMeta = buildCharacterMeta(data);
    } else if (isFlatWorldbookFormat(data)) {
      name = data.name ?? basename(filePath, '.json');
      worldbookName = name;
      form = 'worldbook';
      const flatEntries = Object.values(data.entries ?? {}) as FlatWorldbookEntry[];
      const state = flatEntriesToState(flatEntries, name, worldbookName);

      // merge 模式：合并已有 state 的分类/路径
      // 注意：worldbook 形式下 form=worldbook，state schema 约束 mvu=false，
      // 因此 Zod 脚本检测和 initvar_override 提取均不适用，无需执行。
      // （charactercard 分支在 merge 前调用 detectAndExtractZodFromCard）
      // reservedPaths 始终初始化（fresh 模式下也需防止新增条目互相撞名）
      const reservedPaths = new Set<string>();
      let mergeReservedPaths: Set<string> | undefined;
      if (!opts.fresh) {
        const oldStatePath = opts.state ?? statePath;
        if (existsSync(oldStatePath)) {
          const oldState = readAndValidateOldState(oldStatePath);
          const oldStateDir = dirname(oldStatePath);
          const { state: mergedState, reservedPaths: rp } = mergeWithExistingState(state, oldState, oldStateDir, buildContentLookup(flatEntries));
          Object.assign(state, mergedState);
          for (const p of rp) reservedPaths.add(p);
          mergeReservedPaths = rp;
          console.log(`  Merged with existing state`);
        }
      }

      writeStateWithEntries(state, buildContentLookup(flatEntries), outputDir, reservedPaths);
      if (mergeReservedPaths && mergeReservedPaths.size > 0) {
        console.log(`  ℹ ${mergeReservedPaths.size} file(s) from removed entries preserved on disk (not tracked by new state): ${[...mergeReservedPaths].join(', ')}`);
      }
      console.log(`Unpacked ${flatEntries.length} entries → ${outputDir}`);
      return;
    } else {
      name = data.name ?? basename(filePath, '.json');
      worldbookName = name;
      form = 'worldbook';
      rawEntries = Array.isArray(data.entries)
        ? data.entries
        : Object.values(data.entries ?? {}) as SillyTavernEntry[];
    }
  }

  mkdirSync(outputDir, { recursive: true });

  const state = rawEntriesToState(rawEntries, name, worldbookName, form);

  if (characterMeta) {
    Object.assign(state, {
      description: characterMeta.description,
      first_messages: characterMeta.first_messages,
      creator: characterMeta.creator,
      creator_notes: characterMeta.creator_notes,
      version: characterMeta.version,
      create_date: characterMeta.create_date,
      extensions: characterMeta.extensions,
      regex_scripts: characterMeta.regex_scripts,
    });
  }

  if (detectMvu(state)) {
    state.mvu = true;
  }

  // Zod 脚本检测（在 merge 之前执行，确保从干净角色卡数据提取）
  detectAndExtractZodFromCard(state, outputDir);

  // reservedPaths 始终初始化（fresh 模式下也需防止新增条目互相撞名）
  const reservedPaths = new Set<string>();
  let mergeReservedPaths: Set<string> | undefined;
  if (!opts.fresh) {
    const oldStatePath = opts.state ?? statePath;
    if (existsSync(oldStatePath)) {
      const oldState = readAndValidateOldState(oldStatePath);
      const oldStateDir = dirname(oldStatePath);
      const { state: mergedState, reservedPaths: rp } = mergeWithExistingState(state, oldState, oldStateDir, buildContentLookup(rawEntries));
      Object.assign(state, mergedState);
      for (const p of rp) reservedPaths.add(p);
      mergeReservedPaths = rp;
      console.log(`  Merged with existing state`);
    }
  }

  if (avatarBuffer) {
    const avatarRelPath = 'avatar.png';
    const avatarAbsPath = join(outputDir, avatarRelPath);
    const cleanAvatar = stripCharaChunks(avatarBuffer);
    writeFileRecursive(avatarAbsPath, cleanAvatar);
    state.avatar = avatarRelPath;
  }

  // --- 正则/ : regex_scripts replaceString ---
  if (state.regex_scripts && Object.keys(state.regex_scripts).length > 0) {
    const regexDir = join(outputDir, DIR_REGEX);
    mkdirSync(regexDir, { recursive: true });

    for (const [scriptName, script] of Object.entries(state.regex_scripts)) {
      const replaceString = script.replaceString;
      if (!replaceString) continue;

      const filename = `${sanitizeFilename(scriptName)}.txt`;
      const relPath = join(DIR_REGEX, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, replaceString);
      script.replace_file = relPath;
      delete script.replaceString;
    }
  }

  // --- 脚本/ : tavern_helper scripts content ---
  // Zod 脚本已在 detectAndExtractZodFromCard 中从 scripts 积除，此处只处理普通脚本
  const tavernHelper = state.extensions?.tavern_helper;
  if (tavernHelper?.scripts && Object.keys(tavernHelper.scripts).length > 0) {
    const scriptsDir = join(outputDir, DIR_SCRIPTS);
    mkdirSync(scriptsDir, { recursive: true });

    for (const [scriptName, script] of Object.entries(tavernHelper.scripts)) {
      const content = script.content;
      if (!content) continue;
      // 兜底：Zod 脚本应由 detectAndExtractZodFromCard 移除，若残留则跳过写入
      if (isMvuZodScript(content)) {
        console.warn(`⚠ Zod script "${scriptName}" still present in scripts after extraction; skipping write (managed by schema.ts + state.zod)`);
        continue;
      }

      const filename = `${sanitizeFilename(scriptName)}.txt`;
      const relPath = join(DIR_SCRIPTS, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, content);
      script.script_file = relPath;
      delete script.content;
    }
  }

  // --- 开场白/ : first_messages ---
  if (state.first_messages && state.first_messages.length > 0) {
    const greetingsDir = join(outputDir, DIR_GREETINGS);
    mkdirSync(greetingsDir, { recursive: true });

    const paths: string[] = [];
    const initvarOverrides: Record<string, string> = {};

    for (let gi = 0; gi < state.first_messages.length; gi++) {
      let content = state.first_messages[gi];
      let overrideRelPath: string | undefined;

      // MVU: 提取 <UpdateVariable><initvar> 块
      // 对所有开场白检测（包括 gi === 0），只要有块就提取
      if (state.mvu) {
        const extracted = extractInitvarOverrideFromGreeting(content);
        if (extracted) {
          const overrideFilename = `initvar/${gi}.yaml`;
          overrideRelPath = join(DIR_GREETINGS, overrideFilename);
          const overrideAbsPath = join(outputDir, overrideRelPath);

          mkdirSync(dirname(overrideAbsPath), { recursive: true });
          writeFileRecursive(overrideAbsPath, extracted.initvarYaml);

          content = extracted.cleanedContent;
          console.log(`  Extracted initvar_override → ${overrideRelPath}`);
        }
      }

      // MVU 开场白按内容分流后缀：内容已含占位符 → .txt（pack 幂等跳过追加）；
      // 不含占位符 → .md（pack 不追加，保持 unpack → pack 往返一致）；非 MVU 维持 .txt。
      // 判断基于提取 initvar 之后的 content（占位符在 initvar 块之外，cleanedContent 保留它）。
      const ext = state.mvu && !content.includes(STATUS_PLACEHOLDER) ? '.md' : '.txt';
      const filename = `${gi}${ext}`;
      const relPath = join(DIR_GREETINGS, filename);
      if (overrideRelPath) {
        initvarOverrides[relPath] = overrideRelPath;
      }
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, content);
      paths.push(relPath);
    }

    state.first_messages = paths;
    if (Object.keys(initvarOverrides).length > 0) {
      state.initvar_overrides = initvarOverrides;
    }
  }

  // --- 条目写入 + state.json ---
  writeStateWithEntries(state, buildContentLookup(rawEntries), outputDir, reservedPaths);
  if (mergeReservedPaths && mergeReservedPaths.size > 0) {
    console.log(`  ℹ ${mergeReservedPaths.size} file(s) from removed entries preserved on disk (not tracked by new state): ${[...mergeReservedPaths].join(', ')}`);
  }
  console.log(`Unpacked ${rawEntries.length} entries → ${outputDir}`);
}
