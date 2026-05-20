import { globSync } from 'node:fs';
import { resolve, basename } from 'node:path';

export function globFile(base: string, file: string): string | null {
  const escaped = file.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  const pattern = resolve(base, `${escaped}{.*,}`);
  const matches = globSync(pattern);
  return matches[0] ?? null;
}
