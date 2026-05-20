import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as yaml from 'yaml';
import type { TavernCardsState } from '../type/state.js';

export function readFileText(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
}

export function writeFileRecursive(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJson(path: string, data: unknown, pretty = true): void {
  writeFileRecursive(path, pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data));
}

export function sortEntriesForSerialization(state: TavernCardsState): TavernCardsState {
  const sorted = { ...state };
  const newManifest: typeof state.entryManifest = {};
  for (const [typeName, entries] of Object.entries(state.entryManifest)) {
    const sortedEntries = Object.entries(entries).sort(([, a], [, b]) => {
      const ai = a.display_index ?? a.uid ?? 0;
      const bi = b.display_index ?? b.uid ?? 0;
      return ai - bi;
    });
    const orderedEntries: Record<string, typeof entries[string]> = {};
    for (const [name, leaf] of sortedEntries) {
      orderedEntries[name] = leaf;
    }
    newManifest[typeName] = orderedEntries;
  }
  sorted.entryManifest = newManifest;
  return sorted;
}

export function isYaml(text: string): boolean {
  try {
    const doc = yaml.parse(text, { strict: false, mapAsMap: true });
    return doc !== null && (typeof doc === 'object' || doc instanceof Map);
  } catch {
    return false;
  }
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
