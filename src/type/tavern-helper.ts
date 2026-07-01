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

/** SillyTavern object format: { scripts?: [...], variables?: {...} } */
export interface SillyTavernTavernHelper {
  scripts?: SillyTavernTavernHelperScript[];
  variables?: Record<string, any>;
}
