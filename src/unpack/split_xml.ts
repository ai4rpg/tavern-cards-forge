import { join } from 'node:path';
import { sanitizeFilename } from '../util/sanitize_filename.js';
import { isYaml, writeFileRecursive } from '../util/file_io.js';

const XML_TAG_REGEX = /^<(\w+)>\s*$/;
const XML_CLOSE_REGEX = /^<\/(\w+)>\s*$/;
const XML_OPEN_LINE_REGEX = /^<([A-Za-z_][\w:-]*)(\s+[^<>]*)?>\s*$/;
const XML_CLOSE_LINE_REGEX = /^<\/([A-Za-z_][\w:-]*)>\s*$/;

export function splitXmlTags(content: string): Array<{ content: string; file?: string }> {
  const lines = content.split('\n');
  const result: Array<{ content: string; file?: string }> = [];
  const buffer: string[] = [];
  let openTag: string | null = null;

  function flushBuffer() {
    if (buffer.length > 0) {
      result.push({ content: buffer.join('\n') });
      buffer.length = 0;
    }
  }

  for (const line of lines) {
    const openMatch = line.match(XML_TAG_REGEX);
    const closeMatch = line.match(XML_CLOSE_REGEX);

    if (openMatch && !openTag) {
      flushBuffer();
      openTag = openMatch[1];
      result.push({ content: line });
      continue;
    }

    if (closeMatch && openTag && closeMatch[1] === openTag) {
      buffer.push(line);
      flushBuffer();
      openTag = null;
      continue;
    }

    buffer.push(line);
  }
  flushBuffer();

  return result;
}

export function shouldSplitXml(content: string): boolean {
  return XML_TAG_REGEX.test(content.split('\n')[0] ?? '');
}

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
): Array<{ content?: string; file?: string }> {
  const filename = `${sanitizeFilename(entryName)}.yaml`;
  const relPath = join(entriesDir, filename);
  const absPath = join(outputDir, relPath);

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
