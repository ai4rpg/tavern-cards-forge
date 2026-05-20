export type NumericRole = 0 | 1 | 2;

export type NumericSelectiveLogic = 0 | 1 | 2 | 3;

export type NumericPosition = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const NUMERIC_ROLE_LABELS: Record<NumericRole, 'system' | 'user' | 'assistant'> = {
  0: 'system',
  1: 'user',
  2: 'assistant',
};

export const NUMERIC_POSITION_LABELS: Record<NumericPosition, string> = {
  0: 'before_character_definition',
  1: 'after_character_definition',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
};

export const NUMERIC_SELECTIVE_LOGIC_LABELS: Record<NumericSelectiveLogic, string> = {
  0: 'and_any',
  1: 'not_all',
  2: 'not_any',
  3: 'and_all',
};
