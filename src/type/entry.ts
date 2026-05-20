import type { NumericRole, NumericSelectiveLogic, NumericPosition } from './common.js';

export interface EntryExtensions {
  position: NumericPosition;
  exclude_recursion: boolean;
  display_index: number;
  probability: number;
  useProbability: boolean;
  depth: number;
  selectiveLogic: NumericSelectiveLogic;
  outlet_name: string;
  group: string;
  group_override: boolean;
  group_weight: number;
  prevent_recursion: boolean;
  delay_until_recursion: boolean | number;
  scan_depth: number | null;
  match_whole_words: null;
  use_group_scoring: boolean;
  case_sensitive: null;
  automation_id: string;
  role: NumericRole;
  vectorized: boolean;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  match_persona_description: boolean;
  match_character_description: boolean;
  match_character_personality: boolean;
  match_character_depth_prompt: boolean;
  match_scenario: boolean;
  match_creator_notes: boolean;
  triggers: never[];
  ignore_budget: boolean;
  [key: string]: any;
}

export interface SillyTavernEntry {
  id: number;
  keys: string[];
  secondary_keys: string[];
  comment: string;
  content: string;
  constant: boolean;
  selective: boolean;
  insertion_order: number;
  enabled: boolean;
  position: 'before_char' | 'after_char';
  use_regex: boolean;
  extensions: EntryExtensions;
}
