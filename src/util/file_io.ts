import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as yaml from 'yaml';
import jschardet from 'jschardet';
import type { TavernCardsState } from '../type/state.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function readFileText(path: string): string {
  const buf = readFileSync(path);

  const { encoding, confidence } = jschardet.detect(buf);

  if (encoding && encoding !== 'UTF-8' && encoding !== 'ascii') {
    if (confidence >= 0.7) {
      throw new EncodingError(path, encoding, confidence);
    }
    if (confidence > 0) {
      EncodingError.warn(path, encoding, confidence);
    }
  }

  const hasBom = buf.length >= 3 && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2];
  const text = (hasBom ? buf.subarray(3) : buf).toString('utf-8');

  // Fallback for files too short for jschardet to detect
  if (text.includes('�')) {
    throw new EncodingError(path, 'unknown (possibly GBK/GB2312)', 0);
  }

  return text.replace(/\r\n/g, '\n');
}

export class EncodingError extends Error {
  constructor(filePath: string, detected: string, confidence: number) {
    const confStr = confidence > 0 ? ` (confidence: ${(confidence * 100).toFixed(0)}%)` : '';
    super(
      `Encoding error: "${filePath}" is ${detected}${confStr}, expected UTF-8.\n` +
      'Please re-save the file as UTF-8 and try again.',
    );
    this.name = 'EncodingError';
  }

  static warn(filePath: string, detected: string, confidence: number): void {
    const confStr = confidence > 0 ? ` (confidence: ${(confidence * 100).toFixed(0)}%)` : '';
    console.warn(
      `Warning: "${filePath}" may be ${detected}${confStr}. ` +
      'If the content looks garbled, re-save the file as UTF-8.',
    );
  }
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
