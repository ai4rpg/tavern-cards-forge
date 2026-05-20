import fjp from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import { TavernCardsState } from '../type/state.js';
import { detailedParse } from '../util/prettified_parse.js';

const { applyPatch } = fjp;

export interface ApplyResult {
  success: boolean;
  newState?: unknown;
  error?: string;
}

export function applyPatchAndValidate(
  state: unknown,
  patches: Operation[]
): ApplyResult {
  try {
    const result = applyPatch(state, patches, true);
    const newState = result.newDocument;
    
    try {
      detailedParse(TavernCardsState, newState);
    } catch (validationError) {
      return {
        success: false,
        error: validationError instanceof Error 
          ? 'Schema validation failed: ' + validationError.message
          : 'Schema validation failed',
      };
    }
    
    return { success: true, newState };
  } catch (patchError) {
    return {
      success: false,
      error: patchError instanceof Error 
        ? 'Patch apply failed: ' + patchError.message
        : 'Patch apply failed',
    };
  }
}
