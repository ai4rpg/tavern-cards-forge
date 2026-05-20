export interface SillyTavernTavernHelperScript {
  type: 'script';
  enabled: boolean;
  name: string;
  id: string;
  content: string;
  info: string;
  button?: {
    enabled: boolean;
    buttons?: Array<{
      name: string;
      visible: boolean;
    }>;
  };
  data?: Record<string, any>;
}

/** SillyTavern tuple format: [['scripts', [...]], ['variables', {...}]] */
export type SillyTavernTavernHelperTuple = [
  ['scripts', SillyTavernTavernHelperScript[]],
  ['variables', Record<string, any>],
];

/** SillyTavern object format: { scripts: [...], variables: {...} } */
export interface SillyTavernTavernHelperObject {
  scripts: SillyTavernTavernHelperScript[];
  variables: Record<string, any>;
}

/** Raw tavern_helper can be either tuple or object format depending on the source */
export type SillyTavernTavernHelper = SillyTavernTavernHelperTuple | SillyTavernTavernHelperObject;
