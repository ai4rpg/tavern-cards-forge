import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { readFileText, writeJson } from '../util/file_io.js';

export function createBackup(statePath: string, projectName: string, rootDir: string): string {
  const historyDir = resolve(rootDir, '.patch-history', projectName);
  
  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = resolve(historyDir, `${timestamp}.json`);
  
  copyFileSync(statePath, backupPath);
  
  return backupPath;
}

export function restoreBackup(backupPath: string, statePath: string): void {
  copyFileSync(backupPath, statePath);
}

export function formatBackupPath(backupPath: string, rootDir: string): string {
  return `.${backupPath.slice(rootDir.length)}`;
}
