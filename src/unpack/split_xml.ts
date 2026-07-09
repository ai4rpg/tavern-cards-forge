import { join, dirname, basename, extname } from 'node:path';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { isYaml, writeFileRecursive } from '../util/file_io.js';

const XML_OPEN_LINE_REGEX = /^<([A-Za-z_][\w:-]*)(\s+[^<>]*)?>\s*$/;
const XML_CLOSE_LINE_REGEX = /^<\/([A-Za-z_][\w:-]*)>\s*$/;

export type EntryYamlAnalysis =
  | { kind: 'plain_yaml' }
  | {
      kind: 'wrapped_yaml';
      prefixContent: string[];
      yamlBody: string;
      suffixContent: string[];
    }
  | { kind: 'not_yaml' };

export function analyzeEntryYamlContent(content: string): EntryYamlAnalysis {
  if (isYaml(content)) {
    return { kind: 'plain_yaml' };
  }

  const lines = content.split('\n');
  let start = 0;
  const prefixContent: string[] = [];
  const suffixContent: string[] = [];

  if (lines[0]?.startsWith('@@if ')) {
    prefixContent.push(lines[0]);
    start = 1;
  }

  if (start < lines.length && lines[start]?.trim() === '---') {
    prefixContent.push(lines[start]);
    start += 1;
  }

  let expectedCloseTag: string | null = null;
  if (start < lines.length) {
    const openMatch = lines[start]?.match(XML_OPEN_LINE_REGEX);
    if (openMatch) {
      prefixContent.push(lines[start]);
      expectedCloseTag = openMatch[1];
      start += 1;
    }
  }

  let end = lines.length;
  if (expectedCloseTag) {
    const closeLine = lines[end - 1];
    const closeMatch = closeLine?.match(XML_CLOSE_LINE_REGEX);
    if (!closeMatch || closeMatch[1] !== expectedCloseTag) {
      return { kind: 'not_yaml' };
    }
    suffixContent.unshift(closeLine);
    end -= 1;
  }

  if (prefixContent.length === 0) {
    return { kind: 'not_yaml' };
  }

  const yamlBody = lines.slice(start, end).join('\n');
  if (yamlBody.trim() === '' || !isYaml(yamlBody)) {
    return { kind: 'not_yaml' };
  }

  return {
    kind: 'wrapped_yaml',
    prefixContent,
    yamlBody,
    suffixContent,
  };
}

export function buildWrappedYamlContents(
  analysis: Extract<EntryYamlAnalysis, { kind: 'wrapped_yaml' }>,
  entryName: string,
  entriesDir: string,
  outputDir: string,
  preserveContents?: Array<{ content?: string; file?: string }>,
): Array<{ content?: string; file?: string }> {
  // 保留旧片段中的 file 路径（仅调后缀），否则用 sanitizeFilename 生成新路径
  let relPath: string;
  let absPath: string;
  if (preserveContents) {
    const oldFile = preserveContents.find(f => f.file);
    if (oldFile?.file) {
      const oldDir = dirname(oldFile.file);
      const oldStem = basename(oldFile.file, extname(oldFile.file));
      relPath = join(oldDir, `${oldStem}.yaml`);
    } else {
      const filename = `${sanitizeFilename(entryName)}.yaml`;
      relPath = join(entriesDir, filename);
    }
  } else {
    const filename = `${sanitizeFilename(entryName)}.yaml`;
    relPath = join(entriesDir, filename);
  }
  absPath = join(outputDir, relPath);

  writeFileRecursive(absPath, analysis.yamlBody);

  const fragments: Array<{ content?: string; file?: string }> = [];
  if (analysis.prefixContent.length > 0) {
    if (analysis.prefixContent[0]?.startsWith('@@if ')) {
      fragments.push({ content: analysis.prefixContent[0] });
      if (analysis.prefixContent.length > 1) {
        fragments.push({ content: analysis.prefixContent.slice(1).join('\n') });
      }
    } else {
      fragments.push({ content: analysis.prefixContent.join('\n') });
    }
  }

  fragments.push({ file: relPath });

  if (analysis.suffixContent.length > 0) {
    fragments.push({ content: analysis.suffixContent.join('\n') });
  }

  return fragments;
}
