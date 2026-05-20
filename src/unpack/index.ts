import { detectFileType, extractFromPng, readWorldbookJson } from './extract.js';
import { parseRawEntry, rawEntriesToState } from './parse_raw.js';
import { flatEntriesToState } from './parse_flat_worldbook.js';
import { analyzeEntryYamlContent, buildWrappedYamlContents } from './split_xml.js';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { writeJson, writeFileRecursive, sortEntriesForSerialization } from '../util/file_io.js';
import { resolve, dirname, basename, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SillyTavernEntry, SillyTavernTavernHelper, FlatWorldbookEntry } from '../type/sillytavern.js';
import type { TavernCardsState, TavernHelper, EntryManifestLeaf } from '../type/state.js';
import { resolveProject, ProjectNotFoundError, requireConfiguredProject } from '../cli/settings.js';
import { stripCharaChunks } from '../pack/png_encode.js';

const DIR_ENTRIES = '世界书';
const DIR_REGEX = '正则';
const DIR_SCRIPTS = '脚本';
const DIR_GREETINGS = '开场白';

function detectMvu(state: TavernCardsState): boolean {
  if (state.form !== 'charactercard') return false;

  const scripts = state.extensions?.tavern_helper?.scripts;
  const hasMvuScript = scripts && Object.values(scripts).some(script => {
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

function convertRegexScriptsToState(raw: any[] | undefined): Record<string, any> | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  const result: Record<string, any> = {};
  for (const s of raw) {
    const { scriptName, ...rest } = s;
    const name = scriptName ?? s.id ?? `regex_${raw.indexOf(s)}`;
    result[name] = rest;
  }
  return result;
}

function scriptsArrayToRecord(scripts: Array<Record<string, any>>): TavernHelper['scripts'] {
  const scriptsRecord: Record<string, any> = {};
  for (const s of scripts) {
    const { name, ...rest } = s;
    if (name) scriptsRecord[name] = rest;
  }
  return scriptsRecord as TavernHelper['scripts'];
}

function convertTavernHelperToState(raw: SillyTavernTavernHelper | undefined): TavernHelper | undefined {
  if (!raw) return undefined;

  const result: TavernHelper = {};

  if (Array.isArray(raw)) {
    for (const section of raw) {
      if (!Array.isArray(section) || section.length < 2) continue;

      const [key, value] = section;
      if (key === 'scripts') {
        result.scripts = scriptsArrayToRecord(value as Array<Record<string, any>>);
      } else if (key === 'variables') {
        result.variables = value as TavernHelper['variables'];
      }
    }
  } else if (typeof raw === 'object') {
    if (Array.isArray(raw.scripts)) {
      result.scripts = scriptsArrayToRecord(raw.scripts);
    }
    if (raw.variables) {
      result.variables = raw.variables as TavernHelper['variables'];
    }
  }

  return result.scripts !== undefined || result.variables !== undefined ? result : undefined;
}

function buildCharacterMeta(data: any): Record<string, any> {
  return {
    description: data.data?.description ?? data.description ?? '',
    first_messages: [
      data.data?.first_mes ?? data.first_mes ?? '',
      ...(data.data?.alternate_greetings ?? []),
    ].filter(g => g && g.trim()),
    creator: data.data?.creator ?? '',
    creator_notes: data.data?.creator_notes ?? data.creatorcomment ?? '',
    version: data.data?.character_version ?? '',
    create_date: data.create_date ?? '',
    extensions: {
      tavern_helper: convertTavernHelperToState(data.data?.extensions?.tavern_helper),
      talkativeness: data.data?.extensions?.talkativeness,
      fav: data.data?.extensions?.fav,
      world: data.data?.extensions?.world,
      depth_prompt: data.data?.extensions?.depth_prompt,
    },
    regex_scripts: convertRegexScriptsToState(data.data?.extensions?.regex_scripts),
  };
}

function isFlatWorldbookFormat(data: any): boolean {
  if (!data.entries || typeof data.entries !== 'object') return false;
  const firstEntry = Object.values(data.entries)[0] as any;
  return firstEntry && 'order' in firstEntry && !('insertion_order' in firstEntry);
}

function isCharacterCardJson(data: any): boolean {
  return data.spec && data.spec.startsWith('chara_card') && data.data;
}

function writeEntryBody(
  leaf: EntryManifestLeaf,
  entryName: string,
  body: string,
  outputDir: string,
): void {
  const analysis = analyzeEntryYamlContent(body);

  if (analysis.kind === 'plain_yaml') {
    const filename = `${sanitizeFilename(entryName)}.yaml`;
    const relPath = join(DIR_ENTRIES, filename);
    const absPath = join(outputDir, relPath);

    writeFileRecursive(absPath, body);
    delete leaf.contents;
    leaf.path = relPath;
    return;
  }

  if (analysis.kind === 'wrapped_yaml') {
    delete leaf.path;
    leaf.contents = buildWrappedYamlContents(analysis, entryName, DIR_ENTRIES, outputDir);
    return;
  }

  const filename = `${sanitizeFilename(entryName)}.txt`;
  const relPath = join(DIR_ENTRIES, filename);
  const absPath = join(outputDir, relPath);

  writeFileRecursive(absPath, body);
  delete leaf.contents;
  leaf.path = relPath;
}

function writeStateWithEntries(
  state: TavernCardsState,
  entries: Array<{ content?: string }>,
  outputDir: string,
) {
  mkdirSync(outputDir, { recursive: true });

  const entriesDir = join(outputDir, DIR_ENTRIES);
  mkdirSync(entriesDir, { recursive: true });

  let i = 0;
  const allLeaves = Object.values(state.entryManifest).flatMap(e => Object.entries(e));
  for (const [entryName, leaf] of allLeaves) {
    const raw = entries[i];
    i++;
    if (!raw) continue;

    const content = raw.content ?? '';
    if (!content) {
      delete leaf.contents;
      leaf.path = '';
      continue;
    }

    writeEntryBody(leaf, entryName, content, outputDir);
  }

  writeJson(resolve(outputDir, 'tavern-cards-state.json'), sortEntriesForSerialization(state));
}

export async function runUnpack(
  project: string,
  opts: { file?: string; output?: string; raw?: boolean; split?: boolean },
) {
  const { artifactPath, statePath, projectFound } = resolveProject(project, { artifact: opts.file });
  if (!projectFound && (!opts.file || !opts.output)) {
    requireConfiguredProject(project, projectFound, 'Without a configured project, both --file and --output are required.');
  }

  if (!artifactPath) {
    throw new ProjectNotFoundError(project, 'Provide --file to specify input.');
  }

  const cwd = process.cwd();
  let filePath: string;
  let outputDir = opts.output;

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

      characterMeta = {
        description: data.data?.description ?? data.description ?? '',
        first_messages: [
          data.data?.first_mes ?? data.first_mes ?? '',
          ...(data.data?.alternate_greetings ?? []),
        ].filter(g => g && g.trim()),
        creator: data.data?.creator ?? '',
        creator_notes: data.data?.creator_notes ?? data.creatorcomment ?? '',
        version: data.data?.character_version ?? '',
        create_date: data.create_date ?? '',
        extensions: {
          tavern_helper: convertTavernHelperToState(data.data?.extensions?.tavern_helper),
          talkativeness: data.data?.extensions?.talkativeness,
          fav: data.data?.extensions?.fav,
          world: data.data?.extensions?.world,
          depth_prompt: data.data?.extensions?.depth_prompt,
        },
        regex_scripts: convertRegexScriptsToState(data.data?.extensions?.regex_scripts),
      };
    } else if (isFlatWorldbookFormat(data)) {
      name = data.name ?? basename(filePath, '.json');
      worldbookName = name;
      form = 'worldbook';
      const flatEntries = Object.values(data.entries ?? {}) as FlatWorldbookEntry[];
      const state = flatEntriesToState(flatEntries, name, worldbookName);
      writeStateWithEntries(state, flatEntries, outputDir);
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

  if (opts.raw) {
    writeJson(opts.output ?? resolve(cwd, 'raw.json'), rawEntries);
    console.log(`Raw output → ${opts.output ?? 'raw.json'}`);
    return;
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

  if (avatarBuffer) {
    const avatarRelPath = 'avatar.png';
    const avatarAbsPath = join(outputDir, avatarRelPath);
    const cleanAvatar = stripCharaChunks(avatarBuffer);
    writeFileRecursive(avatarAbsPath, cleanAvatar);
    state.avatar = avatarRelPath;
  }

  // --- 世界书/ : entry content files ---
  const entriesDir = join(outputDir, DIR_ENTRIES);
  mkdirSync(entriesDir, { recursive: true });

  let i = 0;
  const allLeaves = Object.values(state.entryManifest).flatMap(e => Object.entries(e));
  for (const [entryName, leaf] of allLeaves) {
    const raw = rawEntries[i];
    i++;
    if (!raw) continue;

    const content = raw.content ?? '';
    if (!content) {
      delete leaf.contents;
      leaf.path = '';
      continue;
    }

    writeEntryBody(leaf, entryName, content, outputDir);
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
  const tavernHelper = state.extensions?.tavern_helper;
  if (tavernHelper?.scripts && Object.keys(tavernHelper.scripts).length > 0) {
    const scriptsDir = join(outputDir, DIR_SCRIPTS);
    mkdirSync(scriptsDir, { recursive: true });

    for (const [scriptName, script] of Object.entries(tavernHelper.scripts)) {
      const content = script.content;
      if (!content) continue;

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
    for (let gi = 0; gi < state.first_messages.length; gi++) {
      const filename = `${gi}.txt`;
      const relPath = join(DIR_GREETINGS, filename);
      const absPath = join(outputDir, relPath);

      writeFileRecursive(absPath, state.first_messages[gi]);
      paths.push(relPath);
    }
    state.first_messages = paths;
  }

  writeJson(resolve(outputDir, 'tavern-cards-state.json'), sortEntriesForSerialization(state));
  console.log(`Unpacked ${rawEntries.length} entries → ${outputDir}`);
}