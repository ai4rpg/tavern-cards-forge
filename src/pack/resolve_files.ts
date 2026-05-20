import { readFileText } from '../util/file_io.js';
import { resolve, dirname, extname } from 'node:path';
import type { EntryManifestLeaf, TavernCardsState } from '../type/state.js';

export interface ResolvedLeaf extends EntryManifestLeaf {
  name: string;
  content: string;
}

export function resolveFiles(
  state: TavernCardsState,
  stateDir: string,
): ResolvedLeaf[] {
  const results: ResolvedLeaf[] = [];
  const fragmentPaths = collectFragmentPaths(state);

  for (const entries of Object.values(state.entryManifest)) {
    for (const [name, leaf] of Object.entries(entries)) {
      if (isFragment(leaf, fragmentPaths)) continue;

      const content = resolveLeafContent(leaf, stateDir);
      results.push({ ...leaf, name, content });
    }
  }
  return results;
}

function collectFragmentPaths(state: TavernCardsState): Set<string> {
  const paths = new Set<string>();
  for (const entries of Object.values(state.entryManifest)) {
    for (const leaf of Object.values(entries)) {
      if (leaf.contents) {
        for (const fragment of leaf.contents) {
          if (fragment.file) {
            paths.add(normalizePath(fragment.file));
          }
        }
      }
    }
  }
  return paths;
}

function isFragment(leaf: EntryManifestLeaf, fragmentPaths: Set<string>): boolean {
  if (!leaf.path) return false;
  return fragmentPaths.has(normalizePath(leaf.path));
}

function normalizePath(p: string): string {
  return p.replace(/\.(yaml|yml|txt|md|json)$/, '');
}

function resolveLeafContent(leaf: EntryManifestLeaf, stateDir: string): string {
  if (leaf.contents) {
    return leaf.contents
      .map(fragment => {
        if (fragment.file) {
          const filePath = resolve(stateDir, fragment.file);
          return readFileText(filePath);
        }
        return fragment.content ?? '';
      })
      .join('\n');
  }

  if (leaf.path) {
    const filePath = resolve(stateDir, leaf.path);
    return readFileText(filePath);
  }

  return '';
}
