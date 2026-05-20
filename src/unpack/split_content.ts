import { sanitizeFilename } from '../util/sanitize_filename.js';
import { writeFileRecursive, readFileText } from '../util/file_io.js';
import { resolve, join } from 'node:path';
import type { EntryManifestLeaf } from '../type/state.js';

const SPLIT_THRESHOLD = 2000;

export function splitLongContent(
  content: string,
  name: string,
  entryDir: string,
): { leafUpdates: Partial<EntryManifestLeaf>; files: Array<{ path: string; content: string }> } {
  if (content.length < SPLIT_THRESHOLD) {
    return { leafUpdates: {}, files: [] };
  }

  const filename = `${sanitizeFilename(name)}.txt`;
  const filePath = join(entryDir, filename);
  return {
    leafUpdates: { path: filePath },
    files: [{ path: resolve(entryDir, filePath), content }],
  };
}
