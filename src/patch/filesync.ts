import { renameSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { FileOperation } from './patterns.js';

export interface FileSyncResult {
  success: boolean;
  renamed: Array<{ from: string; to: string }>;
  error?: string;
}

export function executeFileOps(
  fileOps: FileOperation[],
  projectDir: string
): FileSyncResult {
  const renamed: Array<{ from: string; to: string }> = [];
  
  try {
    for (const op of fileOps) {
      const fromAbs = resolve(projectDir, op.from);
      const toAbs = resolve(projectDir, op.to);
      
      if (!existsSync(fromAbs)) {
        return {
          success: false,
          renamed,
          error: `source file not found during rename: ${op.from}`,
        };
      }
      
      const toDir = dirname(toAbs);
      if (!existsSync(toDir)) {
        mkdirSync(toDir, { recursive: true });
      }
      
      renameSync(fromAbs, toAbs);
      renamed.push({ from: op.from, to: op.to });
    }
    
    return { success: true, renamed };
  } catch (err) {
    return {
      success: false,
      renamed,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function rollbackFileOps(
  renamed: Array<{ from: string; to: string }>,
  projectDir: string
): void {
  for (const { from, to } of renamed.slice().reverse()) {
    const fromAbs = resolve(projectDir, from);
    const toAbs = resolve(projectDir, to);
    
    try {
      if (existsSync(toAbs)) {
        renameSync(toAbs, fromAbs);
      }
    } catch {
      // 静默失败，尽力回滚
    }
  }
}
