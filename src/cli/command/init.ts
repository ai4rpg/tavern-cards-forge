import { Command } from 'commander';
import * as z from 'zod';
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveProject } from '../settings.js';
import { readFileText, writeFileRecursive, writeJson, sortEntriesForSerialization } from '../../util/file_io.js';
import { detailedParse } from '../../util/prettified_parse.js';
import { TavernCardsState } from '../../type/state.js';

export function registerInit(program: Command, exitOnError: (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => Promise<void>) {
  program
    .command('init')
    .description('Initialize state.json with defaults from .cardrc.json')
    .argument('<project>', 'Project name from .cardrc.json, or any placeholder when --state is provided')
    .option('--state <path>', 'Override state.json path and skip project lookup')
    .action(exitOnError(async (project: string, opts: { state?: string }) => {
      const { cardrc, statePath } = resolveProject(project, opts);

      const stateDir = dirname(statePath);
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }

      let state: z.infer<typeof TavernCardsState>;

      if (existsSync(statePath)) {
        const stateRaw = JSON.parse(readFileText(statePath));
        state = detailedParse(TavernCardsState, stateRaw);
      } else {
        state = detailedParse(TavernCardsState, {
          projectName: project,
          worldbookName: project,
          form: 'charactercard',
          mvu: false,
          entryManifest: {},
          typeLists: cardrc.default_type_lists,
          strategyThresholds: cardrc.default_strategy_thresholds,
          partOrder: cardrc.default_part_order,
          depth_defaults: cardrc.depth_defaults,
          description: '',
          first_messages: [],
          creator: '',
          creator_notes: '',
          version: '1.0',
          create_date: new Date().toISOString(),
        });
        writeJson(statePath, sortEntriesForSerialization(state));
        console.log(`Created → ${statePath}`);
        return;
      }

      // Write defaults from .cardrc.json into existing state
      state.typeLists = cardrc.default_type_lists;
      state.strategyThresholds = cardrc.default_strategy_thresholds;
      state.partOrder = cardrc.default_part_order;
      state.depth_defaults = cardrc.depth_defaults;

      if (!state.projectName) {
        state.projectName = project;
      }
      if (!state.create_date) {
        state.create_date = new Date().toISOString();
      }

      writeJson(statePath, sortEntriesForSerialization(state));
      console.log(`Initialized → ${statePath}`);
    }));
}
