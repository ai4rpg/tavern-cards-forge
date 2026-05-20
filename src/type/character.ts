import type { SillyTavernCharacterBook } from './character-book.js';
import type { SillyTavernRegexScript } from './regex-script.js';
import type { SillyTavernTavernHelper } from './tavern-helper.js';

export interface Asset {
  type: string;
  uri: string;
  name: string;
  ext: string;
}

export interface CharacterExtensions {
  world: string;
  regex_scripts: SillyTavernRegexScript[];
  tavern_helper?: SillyTavernTavernHelper;
  talkativeness: string;
  fav: boolean;
  depth_prompt: { prompt: string; depth: number; role: string };
  [key: string]: any;
}

export interface CharacterData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  creator: string;
  character_version: string;
  alternate_greetings: string[];
  extensions: CharacterExtensions;
  character_book?: SillyTavernCharacterBook;
  
  assets?: Asset[];
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings?: string[];
  creation_date?: number;
  modification_date?: number;
}

export interface SillyTavernCharacter {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creatorcomment: string;
  avatar: string;
  talkativeness: string;
  fav: boolean;
  tags: string[];
  spec: 'chara_card_v2' | 'chara_card_v3';
  spec_version: '2.0' | '3.0';
  create_date: string;
  data: CharacterData;
}

export function isCharacterV3(data: unknown): data is SillyTavernCharacter {
  return typeof data === 'object' && data !== null && 
         (data as Record<string, unknown>).spec === 'chara_card_v3';
}

export function isCharacterV2(data: unknown): data is SillyTavernCharacter {
  return typeof data === 'object' && data !== null && 
         (data as Record<string, unknown>).spec === 'chara_card_v2';
}

export function isCharacter(data: unknown): data is SillyTavernCharacter {
  return isCharacterV2(data) || isCharacterV3(data);
}
