/**
 * schema.ts 源码级重复字段键检测。
 *
 * z.object({...}) 里重复的属性键在 JS 运行时被静默覆盖(后者覆盖前者),运行时 zod
 * 实例只剩一个键、校验检不出,只有前端 vue-tsc(TS1117)会报——必须在源码文本层检出。
 * 用轻量 tokenizer + 括号配对实现,不引入 typescript 包(bundle 体积不变)。
 * 范围:z.object({...})(顶层与嵌套)+ .prefault({...})/.default({...}) 默认值对象。
 */

export interface DuplicateSchemaKeyIssue {
  key: string;     // 规范化键名:字符串键去引号、数字键转字符串
  lines: number[]; // 出现行号(1-based,升序)
  path: string;    // 对象路径,如 "Schema"、"Schema.主角"
  kind: 'z.object' | 'prefault';
}

// ---------------------------------------------------------------------------
// 轻量 tokenizer
// ---------------------------------------------------------------------------

type TokType = 'punc' | 'id' | 'str' | 'num' | 'op';

interface Tok {
  type: TokType;
  value: string;
  line: number; // 1-based
}

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;

function tokenize(content: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = content.length;

  while (i < n) {
    const ch = content[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // 注释整体跳过(内部不参与解析)
    if (ch === '/' && content[i + 1] === '/') {
      while (i < n && content[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        if (content[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // 字符串整体一个 token(含模板字符串 ${} 插值),内容不参与解析
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const strLine = line;
      let j = i + 1;
      while (j < n) {
        const c = content[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') line++;
        if (c === quote) {
          j++;
          break;
        }
        j++;
      }
      toks.push({ type: 'str', value: content.slice(i, j), line: strLine });
      i = j;
      continue;
    }
    if (ch === '`') {
      const strLine = line;
      let j = i + 1;
      let brace = 0;
      while (j < n) {
        const c = content[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') line++;
        if (c === '`' && brace === 0) {
          j++;
          break;
        }
        if (c === '$' && content[j + 1] === '{') {
          brace++;
          j += 2;
          continue;
        }
        if (c === '{' && brace > 0) brace++;
        else if (c === '}' && brace > 0) brace--;
        j++;
      }
      toks.push({ type: 'str', value: content.slice(i, j), line: strLine });
      i = j;
      continue;
    }

    // 标识符(含中文、$、_)
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(content[j])) j++;
      toks.push({ type: 'id', value: content.slice(i, j), line });
      i = j;
      continue;
    }

    // 数字(宽松 lex,仅用于数字键识别)
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObB_.eE+-]/.test(content[j])) j++;
      toks.push({ type: 'num', value: content.slice(i, j), line });
      i = j;
      continue;
    }

    // 参与解析的标点;其余运算符按单字符 op token,不参与键匹配
    if ('{}()[]:,.?;'.includes(ch)) {
      toks.push({ type: 'punc', value: ch, line });
      i++;
      continue;
    }
    toks.push({ type: 'op', value: ch, line });
    i++;
  }

  return toks;
}

// ---------------------------------------------------------------------------
// 对象字面量解析
// ---------------------------------------------------------------------------

interface Prop {
  key: string;
  line: number;
  valueStart: number; // 键值起点 token 下标(冒号后)
  valueEnd: number;   // 键值终点 token 下标(逗号/右花括号前,不含)
}

/**
 * 从 '{' 下标配对解析对象字面量,收集 braceDepth=1 的直接属性。
 * 需区分「属性分隔逗号」与值内部的逗号:同时跟踪 paren/bracket 深度,
 * 保证 z.record(z.string(), z.object({...})) 这类值不被截断。
 * 返回 null 表示未配对到闭合 '}'(合法 schema.ts 不应发生)。
 */
function parseObjectLiteral(toks: Tok[], braceIdx: number): { props: Prop[]; endIdx: number } | null {
  const props: Prop[] = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let atPropStart = true; // 下一个 token 是否处于属性键位置
  let current: { key: string; line: number; valueStart: number } | null = null;

  let i = braceIdx;
  while (i < toks.length) {
    const t = toks[i];

    if (t.type === 'punc') {
      switch (t.value) {
        case '{':
          braceDepth++;
          if (braceDepth === 1 && parenDepth === 0 && bracketDepth === 0) atPropStart = true;
          break;
        case '}': {
          const isObjectEnd = braceDepth === 1 && parenDepth === 0 && bracketDepth === 0;
          if (isObjectEnd) {
            if (current) {
              props.push({ ...current, valueEnd: i });
              current = null;
            }
            return { props, endIdx: i };
          }
          braceDepth--;
          atPropStart = false;
          break;
        }
        case '(':
          parenDepth++;
          atPropStart = false;
          break;
        case ')':
          parenDepth--;
          atPropStart = false;
          break;
        case '[':
          bracketDepth++;
          atPropStart = false;
          break;
        case ']':
          bracketDepth--;
          atPropStart = false;
          break;
        case ',':
          if (braceDepth === 1 && parenDepth === 0 && bracketDepth === 0) {
            if (current) {
              props.push({ ...current, valueEnd: i });
              current = null;
            }
            atPropStart = true;
          } else {
            atPropStart = false;
          }
          break;
        case ':':
          atPropStart = false;
          break;
        case '?': // 可选键标记或三元:不改 atPropStart
          break;
        default:
          atPropStart = false;
          break;
      }
    } else if (t.type === 'id' || t.type === 'str' || t.type === 'num') {
      if (braceDepth === 1 && parenDepth === 0 && bracketDepth === 0 && atPropStart) {
        // 属性键候选:向后看 (?:)? :
        let j = i + 1;
        if (toks[j]?.type === 'punc' && toks[j].value === '?') j++;
        if (toks[j]?.type === 'punc' && toks[j].value === ':') {
          current = { key: normalizeKey(t), line: t.line, valueStart: j + 1 };
          atPropStart = false;
          i = j; // 跳到冒号位置(其分支只置 atPropStart=false)
          i++;
          continue;
        }
      }
      atPropStart = false;
    } else {
      atPropStart = false;
    }

    i++;
  }

  return null; // 未闭合
}

/** 键名规范化:字符串去引号、数字转字符串,使 'a' 与 a、1 与 '1' 可合并比较 */
function normalizeKey(t: Tok): string {
  if (t.type === 'str') {
    let s = t.value.slice(1, -1);
    s = s.replace(/\\(['"\\nrtbfv0])/g, (_m, c: string) => {
      switch (c) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return '\0';
        default: return c;
      }
    });
    return s;
  }
  if (t.type === 'num') return t.value;
  return t.value;
}

// ---------------------------------------------------------------------------
// 扫描与汇总
// ---------------------------------------------------------------------------

function reportDuplicates(props: Prop[], path: string, kind: 'z.object' | 'prefault', issues: DuplicateSchemaKeyIssue[]): void {
  const byKey = new Map<string, number[]>();
  for (const p of props) {
    const arr = byKey.get(p.key);
    if (arr) arr.push(p.line);
    else byKey.set(p.key, [p.line]);
  }
  for (const [key, lines] of byKey) {
    if (lines.length > 1) {
      issues.push({ key, lines: [...lines].sort((a, b) => a - b), path, kind });
    }
  }
}

function isPunc(t: Tok | undefined, value: string): boolean {
  return t !== undefined && t.type === 'punc' && t.value === value;
}

/** 在 token 区间递归扫描 z.object({...}) 与 prefault/default 对象字面量,path 为所在键路径 */
function scanRange(toks: Tok[], from: number, to: number, path: string, issues: DuplicateSchemaKeyIssue[]): void {
  let i = from;
  while (i < to) {
    const t = toks[i];

    // z.object( { → 解析形状对象,再递归进每个键值
    if (
      t.type === 'id' && t.value === 'z' &&
      isPunc(toks[i + 1], '.') &&
      toks[i + 2]?.type === 'id' && toks[i + 2].value === 'object' &&
      isPunc(toks[i + 3], '(') &&
      isPunc(toks[i + 4], '{')
    ) {
      const parsed = parseObjectLiteral(toks, i + 4);
      if (parsed) {
        reportDuplicates(parsed.props, path, 'z.object', issues);
        for (const p of parsed.props) {
          scanRange(toks, p.valueStart, p.valueEnd, `${path}.${p.key}`, issues);
        }
        i = parsed.endIdx + 1;
        continue;
      }
    }

    // prefault( { / default( { → 默认值对象(值内不会有 z.object,不递归)
    if (
      t.type === 'id' && (t.value === 'prefault' || t.value === 'default') &&
      isPunc(toks[i + 1], '(') &&
      isPunc(toks[i + 2], '{')
    ) {
      const parsed = parseObjectLiteral(toks, i + 2);
      if (parsed) {
        reportDuplicates(parsed.props, path, 'prefault', issues);
        i = parsed.endIdx + 1;
        continue;
      }
    }

    i++;
  }
}

/** 检测 schema.ts 源码中的重复字段键(运行时重复键已被覆盖,只能源码层检出) */
export function detectDuplicateSchemaKeys(content: string): DuplicateSchemaKeyIssue[] {
  const toks = tokenize(content);
  const issues: DuplicateSchemaKeyIssue[] = [];
  const rootName = content.match(/export\s+const\s+(\w+)\s*=\s*/)?.[1] ?? 'Schema';
  scanRange(toks, 0, toks.length, rootName, issues);
  return issues;
}

/** 格式化为用户可见错误文本 */
export function formatDuplicateSchemaKeyIssues(issues: DuplicateSchemaKeyIssue[], sourceLabel = 'schema.ts'): string {
  const detail = issues.map(issue => {
    const suffix = issue.kind === 'prefault' ? ' (prefault default object)' : '';
    return `  - ${issue.path}.${issue.key}${suffix}: appears ${issue.lines.length} times (lines ${issue.lines.join(', ')})`;
  });
  return [
    `${sourceLabel} has duplicate field keys (later key overrides earlier one; Zod keeps only the last at runtime):`,
    ...detail,
    '',
    'Remove the redundant definitions and keep a single key (frontend vue-tsc reports the same as TS1117).',
  ].join('\n');
}
