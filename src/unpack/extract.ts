import { extractCharaFromPng } from '../pack/png_encode.js';
import { readFileSync } from 'node:fs';
import { extname, resolve, basename } from 'node:path';

export function extractFromPng(pngPath: string): { type: 'character'; data: any; imageBuffer: Buffer } {
  const image = readFileSync(pngPath);
  const jsonStr = extractCharaFromPng(image);
  if (!jsonStr) throw new Error(`No chara/ccv3 chunk found in ${pngPath}`);
  return { type: 'character', data: JSON.parse(jsonStr), imageBuffer: image };
}

export function readWorldbookJson(jsonPath: string): { type: 'worldbook'; data: any } {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  return { type: 'worldbook', data: raw };
}

export function detectFileType(path: string): 'png' | 'json' {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.json') return 'json';
  throw new Error(`Unsupported file type: ${ext}`);
}
