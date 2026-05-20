import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TavernCardsState, EntryManifestLeaf, RegexScript, TavernHelperScript } from '../type/state.js';

const FILE_PATH_PATTERNS = [
  /^\/entryManifest\/[^/]+\/[^/]+\/path$/,
  /^\/entryManifest\/[^/]+\/[^/]+\/contents\/\d+\/file$/,
  /^\/regex_scripts\/[^/]+\/replace_file$/,
  /^\/extensions\/tavern_helper\/scripts\/[^/]+\/script_file$/,
  /^\/avatar$/,
  /^\/first_messages\/\d+$/,
];

export function isFilePathField(pointer: string): boolean {
  return FILE_PATH_PATTERNS.some(p => p.test(pointer));
}

export function extractFilePathsFromValue(value: unknown, basePath: string): string[] {
  const paths: string[] = [];
  
  if (typeof value === 'string') {
    paths.push(basePath);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => {
      paths.push(...extractFilePathsFromValue(item, `${basePath}/${i}`));
    });
  } else if (value && typeof value === 'object') {
    if ('path' in value && typeof (value as any).path === 'string') {
      paths.push(`${basePath}/path`);
    }
    if ('contents' in value && Array.isArray((value as any).contents)) {
      (value as any).contents.forEach((item: any, i: number) => {
        if (item && typeof item === 'object' && 'file' in item && typeof item.file === 'string') {
          paths.push(`${basePath}/contents/${i}/file`);
        }
      });
    }
  }
  
  return paths;
}

export function collectLeafFilePaths(leaf: EntryManifestLeaf): string[] {
  const paths: string[] = [];
  
  if (leaf.path) {
    paths.push(leaf.path);
  }
  
  if (leaf.contents) {
    for (const fragment of leaf.contents) {
      if (fragment.file) {
        paths.push(fragment.file);
      }
    }
  }
  
  return paths;
}

export function collectRegexScriptFilePaths(script: RegexScript): string[] {
  const paths: string[] = [];
  if (script.replace_file) {
    paths.push(script.replace_file);
  }
  return paths;
}

export function collectTavernHelperScriptFilePaths(script: TavernHelperScript): string[] {
  const paths: string[] = [];
  if (script.script_file) {
    paths.push(script.script_file);
  }
  return paths;
}

export interface FilePathValidation {
  path: string;
  exists: boolean;
}

export function validateAllFilePaths(
  state: TavernCardsState,
  projectDir: string
): FilePathValidation[] {
  const results: FilePathValidation[] = [];
  
  for (const entries of Object.values(state.entryManifest)) {
    for (const leaf of Object.values(entries)) {
      for (const relPath of collectLeafFilePaths(leaf)) {
        const absPath = resolve(projectDir, relPath);
        results.push({ path: relPath, exists: existsSync(absPath) });
      }
    }
  }
  
  if (state.regex_scripts) {
    for (const script of Object.values(state.regex_scripts)) {
      for (const relPath of collectRegexScriptFilePaths(script)) {
        const absPath = resolve(projectDir, relPath);
        results.push({ path: relPath, exists: existsSync(absPath) });
      }
    }
  }
  
  if (state.extensions?.tavern_helper?.scripts) {
    for (const script of Object.values(state.extensions.tavern_helper.scripts)) {
      for (const relPath of collectTavernHelperScriptFilePaths(script)) {
        const absPath = resolve(projectDir, relPath);
        results.push({ path: relPath, exists: existsSync(absPath) });
      }
    }
  }
  
  if (state.avatar && state.avatar.trim() !== '') {
    const absPath = resolve(projectDir, state.avatar);
    results.push({ path: state.avatar, exists: existsSync(absPath) });
  }
  
  for (const relPath of state.first_messages) {
    const absPath = resolve(projectDir, relPath);
    results.push({ path: relPath, exists: existsSync(absPath) });
  }
  
  return results;
}
