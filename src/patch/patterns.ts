import type { Operation } from 'fast-json-patch';
import { isFilePathField, extractFilePathsFromValue } from '../util/file_paths.js';

export { isFilePathField, extractFilePathsFromValue };
export type { Operation };

export interface FileOperation {
  patchIndex: number;
  from: string;
  to: string;
}

export interface PrecheckError {
  patchIndex: number;
  path: string;
  message: string;
}

export interface PrecheckWarning {
  message: string;
}

export interface PrecheckResult {
  errors: PrecheckError[];
  warnings: PrecheckWarning[];
  fileOps: FileOperation[];
}
