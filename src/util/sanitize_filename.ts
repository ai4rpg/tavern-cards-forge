const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeFilename(name: string): string {
  let result = name.replace(ILLEGAL_CHARS, '_').trim();
  if (WINDOWS_RESERVED.test(result)) {
    result = '_' + result;
  }
  if (result.length > 200) {
    result = result.slice(0, 200);
  }
  return result;
}
