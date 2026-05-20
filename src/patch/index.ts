import { dirname, resolve } from 'node:path';
import { detailedParse } from '../util/prettified_parse.js';
import { TavernCardsState } from '../type/state.js';
import { readFileText, writeJson, sortEntriesForSerialization } from '../util/file_io.js';
import { precheck } from './precheck.js';
import { executeFileOps, rollbackFileOps } from './filesync.js';
import { createBackup, restoreBackup, formatBackupPath } from './history.js';
import { applyPatchAndValidate } from './apply.js';
import { validateState } from '../configure/validate.js';
import { resolveProject } from '../cli/settings.js';
import type { Operation } from './patterns.js';

export interface PatchOptions {
  state?: string;
  dryRun?: boolean;
  noBackup?: boolean;
}

export async function runPatch(project: string, patches: Operation[], opts: PatchOptions): Promise<void> {
  const { cardrc, rootDir, statePath, projectFound } = resolveProject(project, { state: opts.state });
  const projectDir = dirname(statePath);

  const stateRaw = JSON.parse(readFileText(statePath));
  const state = detailedParse(TavernCardsState, stateRaw);

  const precheckResult = precheck(patches, state, projectDir);

  if (precheckResult.errors.length > 0) {
    throw new Error('Precheck FAILED:\n' + precheckResult.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n'));
  }

  if (precheckResult.warnings.length > 0) {
    console.log('Warnings:');
    for (const w of precheckResult.warnings) {
      console.log(`  - ${w.message}`);
    }
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Precheck: OK');
    if (precheckResult.fileOps.length > 0) {
      console.log('Files would rename:');
      for (const op of precheckResult.fileOps) {
        console.log(`  ${op.from} → ${op.to}`);
      }
    }

    const applyResult = applyPatchAndValidate(state, patches);
    if (applyResult.success) {
      console.log('Validation: OK');
      console.log(`${patches.length} operations ready to apply`);
    } else {
      throw new Error(`Validation FAILED: ${applyResult.error}`);
    }
    return;
  }

  console.log('Precheck: OK');

  let backupPath: string | null = null;
  if (!opts.noBackup) {
    backupPath = createBackup(statePath, projectFound ? project : 'adhoc', rootDir);
  }

  const fileSyncResult = executeFileOps(precheckResult.fileOps, projectDir);
  if (!fileSyncResult.success) {
    console.error(`File operation failed: ${fileSyncResult.error}`);
    rollbackFileOps(fileSyncResult.renamed, projectDir);
    if (backupPath) {
      restoreBackup(backupPath, statePath);
    }
    throw new Error(`File operation failed: ${fileSyncResult.error}`);
  }

  if (fileSyncResult.renamed.length > 0) {
    console.log('Files:');
    for (const r of fileSyncResult.renamed) {
      console.log(`  renamed ${r.from} → ${r.to}`);
    }
  }

  const applyResult = applyPatchAndValidate(state, patches);
  if (!applyResult.success || !applyResult.newState) {
    rollbackFileOps(fileSyncResult.renamed, projectDir);
    if (backupPath) {
      restoreBackup(backupPath, statePath);
    }
    throw new Error(`Patch failed: ${applyResult.error}`);
  }

  const validateResult = validateState(applyResult.newState as TavernCardsState);
  if (validateResult.errors.length > 0) {
    console.log('Validation warnings:');
    for (const err of validateResult.errors) {
      console.log(`  - ${err}`);
    }
  }

  writeJson(statePath, sortEntriesForSerialization(applyResult.newState as any));
  console.log(`Applied ${patches.length} operations → ${statePath}`);

  if (backupPath) {
    console.log(`Backup: ${formatBackupPath(backupPath, rootDir)}`);
  }
}
