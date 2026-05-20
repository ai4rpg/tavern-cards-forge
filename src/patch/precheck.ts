import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Operation } from './patterns.js';
import { isFilePathField, extractFilePathsFromValue, type FileOperation, type PrecheckError, type PrecheckWarning, type PrecheckResult } from './patterns.js';

function getValueByPointer(obj: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') return obj;
  
  const segments = pointer.split('/').slice(1);
  let current: unknown = obj;
  
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  
  return current;
}

export function precheck(
  patches: Operation[],
  state: unknown,
  projectDir: string
): PrecheckResult {
  const errors: PrecheckError[] = [];
  const warnings: PrecheckWarning[] = [];
  const fileOps: FileOperation[] = [];

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const patchPath = patch.path;

    if (patch.op === 'add' && isFilePathField(patchPath)) {
      const filePaths = patch.value !== undefined 
        ? extractFilePathsFromValue(patch.value, patchPath)
        : [];
      
      for (const fp of filePaths) {
        const relativePath = fp === patchPath 
          ? patch.value 
          : getValueByPointer(patch.value, fp.replace(patchPath, '') || '');
        
        if (typeof relativePath === 'string') {
          const absolutePath = resolve(projectDir, relativePath);
          if (!existsSync(absolutePath)) {
            errors.push({
              patchIndex: i,
              path: fp,
              message: 'file not found: ' + relativePath,
            });
          }
        }
      }
    }

    if (patch.op === 'replace' && isFilePathField(patchPath)) {
      const oldRelativePath = getValueByPointer(state, patchPath);
      const newRelativePath = patch.value;

      if (typeof oldRelativePath !== 'string') {
        errors.push({
          patchIndex: i,
          path: patchPath,
          message: 'existing value is not a file path',
        });
        continue;
      }

      if (typeof newRelativePath !== 'string') {
        continue;
      }

      const oldAbsolutePath = resolve(projectDir, oldRelativePath);
      const newAbsolutePath = resolve(projectDir, newRelativePath);

      if (!existsSync(oldAbsolutePath)) {
        errors.push({
          patchIndex: i,
          path: patchPath,
          message: 'source file not found: ' + oldRelativePath,
        });
      }

      if (oldRelativePath !== newRelativePath && existsSync(newAbsolutePath)) {
        errors.push({
          patchIndex: i,
          path: patchPath,
          message: 'target file already exists: ' + newRelativePath,
        });
      }

      if (oldRelativePath !== newRelativePath) {
        fileOps.push({
          patchIndex: i,
          from: oldRelativePath,
          to: newRelativePath,
        });
      }
    }

    if (patch.op === 'move' || patch.op === 'copy') {
      const entryPathPattern = /^\/entryManifest\/([^/]+)\/([^/]+)$/;
      const fromMatch = patch.from?.match(entryPathPattern);
      const toMatch = patchPath.match(entryPathPattern);

      if (fromMatch && toMatch) {
        const [, , fromName] = fromMatch;
        const [, , toName] = toMatch;
        if (fromName !== toName) {
          warnings.push({
            message: 'renamed entry "' + fromName + '" → "' + toName + '", file paths unchanged. Consider updating path field for consistency.',
          });
        }
      }
    }

    if (patch.op === 'remove' && isFilePathField(patchPath)) {
      // remove 不验证，文件保留
    }
  }

  return { errors, warnings, fileOps };
}
