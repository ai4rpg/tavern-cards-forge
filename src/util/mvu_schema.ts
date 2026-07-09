import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti/static';
import * as z from 'zod';
import * as _ from 'lodash';
import * as yaml from 'yaml';
import { readFileText } from './file_io.js';
import { detailedParse } from './prettified_parse.js';
import type { EntryManifest, ZodDescriptor } from '../type/state.js';
import type { ZodType } from 'zod';

/** jsdelivr CDN 路径（不含域名），用于检测 Zod 脚本 */
const MVU_ZOD_CDN_PATH = 'StageDog/tavern_resource/dist/util/mvu_zod.js';

/** registerMvuSchema 的默认 import URL */
const DEFAULT_MVU_ZOD_IMPORT_URL = `https://testingcf.jsdelivr.net/gh/${MVU_ZOD_CDN_PATH}`;

/** 匹配 import 语句中含 registerMvuSchema 的行（含可选别名）
 *  手写格式：import { registerMvuSchema } 或 import { registerMvuSchema as alias }
 *  压缩格式：import{registerMvuSchema as e}
 *  捕获组 1: 别名（as 后的标识符），无别名时为 undefined */
const REGISTER_MVU_SCHEMA_IMPORT_RE = /import\s*\{[^}]*registerMvuSchema\s+(?:as\s+(\w+))?[^}]*\}/;

/**
 * 从已有 Zod 脚本内容中提取 registerMvuSchema 的 import URL
 * 支持不同的 jsdelivr CDN 域名（testingcf / fastly / 默认等）
 * @returns import URL；未找到时返回默认 URL
 */
export function detectMvuZodImportUrl(zodScriptContent: string): string {
  const match = zodScriptContent.match(
    /import\s*\{[^}]*registerMvuSchema[^}]*\}\s*from\s*['"]([^'"]+StageDog\/tavern_resource\/dist\/util\/mvu_zod\.js)['"]/
  );
  return match ? match[1] : DEFAULT_MVU_ZOD_IMPORT_URL;
}

/** 检测脚本内容是否为 MVU Zod schema 脚本（Zod 版特有） */
export function isMvuZodScript(content: string): boolean {
  // 使用路径而非完整 URL 检测，兼容不同 jsdelivr CDN 域名
  if (!content.includes('registerMvuSchema')
      || !content.includes(MVU_ZOD_CDN_PATH)) {
    return false;
  }

  // 从 import 语句中提取 registerMvuSchema 的调用名（可能被别名）
  const importMatch = content.match(REGISTER_MVU_SCHEMA_IMPORT_RE);
  if (!importMatch) return false;

  const callName = importMatch[1] || 'registerMvuSchema';  // 别名或原名

  // 查找 callName(xxx) 调用
  const callMatch = content.match(new RegExp(`\\b${callName}\\s*\\(\\s*(\\w+)\\s*\\)`));
  if (!callMatch) return false;

  const schemaVar = callMatch[1];  // \w+ 只含字母数字下划线，注入正则安全

  // 确认该变量被导出（支持两种 export 格式）
  // 手写格式：export const Schema = ...
  // 压缩格式：export{r as Schema}
  return new RegExp(`export\\s+const\\s+${schemaVar}\\b`).test(content)
      || new RegExp(`export\\s*\\{[^}]*\\b${schemaVar}\\s+as\\s+Schema\\b[^}]*\\}`).test(content);
}

/**
 * 从 schema.ts 内容生成 Zod 脚本（extractSchemaTsFromScript 的逆操作）
 * 1. 移除 export type 行
 * 2. 在顶部添加 registerMvuSchema import
 * 3. 在底部添加注册调用
 *
 * @param schemaTsContent schema.ts 文件内容
 * @param importUrl registerMvuSchema 的 import URL；缺省使用默认 CDN
 */
export function buildZodScriptFromSchemaTs(schemaTsContent: string, importUrl?: string): string {
  const url = importUrl ?? DEFAULT_MVU_ZOD_IMPORT_URL;

  // 从 schema.ts 中动态提取 Schema 变量名（export const xxx = ...）
  const schemaVarMatch = schemaTsContent.match(/export\s+const\s+(\w+)\s*=\s*/);
  const schemaVar = schemaVarMatch?.[1] ?? 'Schema';

  const lines = schemaTsContent.split('\n');
  const filtered = lines.filter(l => !/^export\s+type\s+/.test(l));

  // 清理末尾空行
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') filtered.pop();

  // $() 是 SillyTavern 脚本加载钩子（jQuery ready wrapper），
  // 脚本在 ST 加载时由 jQuery 评估，$() 保证 DOM 就绪后执行注册。
  return [
    `import { registerMvuSchema } from '${url}';`,
    ...filtered,
    '',
    '$(() => {',
    `  registerMvuSchema(${schemaVar});`,
    '});',
  ].join('\n');
}

/**
 * 检测 Zod 脚本是否为压缩/编译产物
 * 压缩脚本的特征：sourceMappingURL、import 别名、单行超长代码
 */
function isMinifiedZodScript(content: string): boolean {
  // sourceMappingURL 是构建工具的明确标记
  if (content.includes('sourceMappingURL')) return true;

  // import 别名：import{registerMvuSchema as xxx}
  if (/import\s*\{[^}]*registerMvuSchema\s+as\s+\w+/.test(content)) return true;

  // 单行超长：有效代码行超过 5000 字符（手写脚本不会有这种行）
  const lines = content.split('\n');
  if (lines.some(l => l.length > 5000 && l.trim().length > 0)) return true;

  return false;
}

/**
 * 从 Zod 脚本内容提取 schema.ts 源码
 * 移除 registerMvuSchema import 和注册调用，添加类型导出
 *
 * **仅适用于手写格式**的 Zod 脚本。压缩/编译脚本无法可靠提取——
 * 变量名被缩短、z 被别名化、schema 定义与运行时代码混在单行中。
 * 对压缩脚本应调用 isMinifiedZodScript 先行检测，跳过提取。
 *
 * @returns 提取的 schema.ts 内容；压缩脚本返回 null
 */
export function extractSchemaTsFromScript(content: string): string | null {
  if (isMinifiedZodScript(content)) return null;

  const lines = content.split('\n');
  const result: string[] = [];
  let inRegisterBlock = false;

  for (const line of lines) {
    // 跳过 registerMvuSchema import 行
    if (/^\s*import\s+.*registerMvuSchema/.test(line)) continue;

    // 检测注册块开始 $(() => { 或 $(async() => {
    if (/^\s*\$\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{/.test(line)) {
      inRegisterBlock = true;
      continue;
    }

    // 在注册块内，跳过所有行直到 });
    if (inRegisterBlock) {
      if (/^\s*\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(line)) {
        inRegisterBlock = false;
      }
      continue;
    }

    result.push(line);
  }

  // 在文件末尾添加类型导出（必须在顶级作用域，不能插入 z.object({}) 块内）
  const schemaLineIdx = result.findIndex(l => /^\s*export\s+const\s+(\w+)\s*=/.test(l));
  if (schemaLineIdx !== -1) {
    const varMatch = result[schemaLineIdx].match(/export\s+const\s+(\w+)/);
    const varName = varMatch?.[1] ?? 'Schema';
    if (!result.some(l => new RegExp(`export\\s+type\\s+${varName}\\s*=`).test(l))) {
      result.push('', `export type ${varName} = z.output<typeof ${varName}>;`);
    }
  }

  // 清理末尾空行
  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();

  return result.join('\n') + '\n';
}

/**
 * ST 端 `Script` schema (JS-Slash-Runner/src/type/scripts.ts) 中各字段的运行时默认值。
 * 这是 forge 与 ST 之间的契约单一事实源：unpack 时把命中这些默认值的字段剥离（保持 state.json 极简），
 * pack 时再恢复成 ST 原生完整默认值输出（保证 forge pack 出的角色卡与 ST 直接导出的角色卡字段一致）。
 *
 * 注意：zod 4 的 `.default(v)` / `.prefault(v)` 在 `.parse()` 时会把 `v` 写入返回对象,
 * 所以从 ST 导出的角色卡 JSON 中这些字段必然是「完整默认值对象」(空串/空对象/空数组而非键缺失)，
 * 必须 `_.isEqual` 与默认值做深度比较来识别「实际等于缺省」的字段。
 *
 * 仅覆盖 ZodDescriptor 关心的 button / info / data 三字段;
 * `id` (ST 端 `.default(() => uuidv4())` 不可复现) 与 `enabled` (Zod 脚本恒为 true) 不在此处处理。
 */
export const ST_SCRIPT_DEFAULTS: {
  info: string;
  button: NonNullable<ZodDescriptor['button']>;
  data: Record<string, any>;
} = {
  info: '',
  button: { enabled: true, buttons: [] },
  data: {},
};

/** button / info / data 三字段的「已缺省 (strip 后)」或「已恢复」的共用形态类型 */
export type StrippedScriptFields = Pick<ZodDescriptor, 'button' | 'info' | 'data'>;

/**
 * 从单个脚本字段对象中剥离与 ST 默认值相同的 button / info / data, 返回精简对象.
 * 仅用于 unpack: 把从角色卡提取、即将写入 state.zod 的额外字段做减法, 保证 state 极简.
 *
 * 命中默认值的字段不写入返回对象; 与默认值不同的字段原样保留.
 */
export function stripScriptDefaults(script: StrippedScriptFields): StrippedScriptFields {
  const out: StrippedScriptFields = {};
  if (script.info !== undefined && !_.isEqual(script.info, ST_SCRIPT_DEFAULTS.info)) out.info = script.info;
  if (script.button !== undefined && !_.isEqual(script.button, ST_SCRIPT_DEFAULTS.button)) out.button = script.button;
  if (script.data !== undefined && !_.isEqual(script.data, ST_SCRIPT_DEFAULTS.data)) out.data = script.data;
  return out;
}

/**
 * 恢复 ST 原生完整默认值到 button / info / data (pack 时输出与 ST 直接导出一致的完整字段).
 * 反向于 stripScriptDefaults: state.zod 中缺省 (即被 strip 过) 的字段回填 ST 默认值.
 *
 * @param zod Zod 描述符, 其 button/info/data 可能为「已被 strip 的缺省态」或「用户/角色卡的非默认值」
 * @returns buttons/info/data 该写入输出角色卡的完整值
 */
function restoreScriptDefaults(zod: Pick<ZodDescriptor, 'button' | 'info' | 'data'>): {
  info: string;
  button: NonNullable<ZodDescriptor['button']>;
  data: Record<string, any>;
} {
  return {
    info: zod.info ?? ST_SCRIPT_DEFAULTS.info,
    button: zod.button ?? ST_SCRIPT_DEFAULTS.button,
    data: zod.data ?? ST_SCRIPT_DEFAULTS.data,
  };
}

/**
 * 为 pack 流程准备 Zod 同步所需的全部输入
 * 从 state.zod 指定的 schemaPath 读取 schema.ts，预检并生成 Zod 脚本内容
 *
 * @param stateDir state.json 所在目录
 * @param zod Zod 描述符（来自 state.zod）
 * @returns schema.ts 内容和同步生成的 Zod 脚本内容
 * @throws schema.ts 不存在或预检失败时抛出 Error
 */
export function prepareZodSync(stateDir: string, zod: ZodDescriptor): { schemaContent: string; zodSubject: string } {
  const absPath = resolve(stateDir, zod.schemaPath);
  if (!existsSync(absPath)) throw new Error(`schema.ts not found: ${absPath}`);
  const schemaContent = readFileText(absPath);
  const schemaImportErrors = checkSchemaTsContent(schemaContent);
  if (schemaImportErrors.length > 0) throw new Error(schemaImportErrors.join('\n'));
  const zodSubject = buildZodScriptFromSchemaTs(schemaContent, zod.importUrl);
  return { schemaContent, zodSubject };
}

/**
 * 构造完整的 TavernHelperScript 条目（用于 pack 时注入回 tavern_helper.scripts）
 * 使用固化的 zod.scriptId 保证跨 pack id 稳定（ST 端 id 缺省会 uuidv4 随机生成，不稳定）。
 *
 * 字段写入策略（回填 ST 默认值，与 ST 原生导出保持一致）:
 * - button / info / data 三字段依据 `restoreScriptDefaults` 恢复成 ST 端 Script schema 的完整默认值,
 *   即 state.zod 中被 strip 缺省的字段在输出角色卡中回填为 ST 默认 (button: {enabled:true,buttons:[]}, info: '', data: {})
 * - state.zod 中若存有用户/角色卡的非默认值则原样保留 (覆盖默认值)
 * - 反向操作在 unpack 端 `detectAndExtractZodFromCard` 用 `stripScriptDefaults` 完成
 */
export function buildZodScriptEntry(zod: ZodDescriptor, content: string): Record<string, any> {
  const { info, button, data } = restoreScriptDefaults(zod);
  return {
    type: 'script' as const,
    content,
    enabled: true,
    id: zod.scriptId,
    info,
    button,
    data,
  };
}

/** schema.ts 内容预检：是否含有不应存在的 import 语句 */
export function checkSchemaTsContent(content: string): string[] {
  const importLines: string[] = [];
  for (const line of content.split('\n')) {
    if (/^\s*import\s/.test(line)) {
      importLines.push(line.trim());
    }
  }
  if (importLines.length === 0) return [];

  return [
    `schema.ts must not contain import statements:`,
    ...importLines.map(l => `  - ${l}`),
    '',
    'All required functionality (z, _) is already available as globals in the MVU runtime.',
    'Remove all imports from schema.ts — forge does not bundle additional packages.',
  ];
}

/** Zod 脚本内容校验结果 */
export interface ZodScriptValidationResult {
  /** 是否发现 export type ... 类问题（TypeScript 语法不是合法 JavaScript） */
  typeExport: boolean;
}

/**
 * 校验 Zod 脚本内容是否含有会导致运行时失效的模式
 * - export type ... → TypeScript 语法不是合法 JavaScript
 *
 * import 相关检查由 checkSchemaTsContent 在上游完成（禁止所有 import），
 * 此处仅检测 typeExport（checkSchemaTsContent 不覆盖）。
 */
export function validateZodScriptContent(content: string): ZodScriptValidationResult {
  const typeExport = /^export\s+type\s+/m.test(content);
  return { typeExport };
}

/**
 * 将 ZodScriptValidationResult 格式化为用户可见的错误信息
 *
 * @param issues  校验结果
 * @param _content 原始脚本内容（保留参数位兼容，当前未使用）
 * @param sourceLabel 被校验来源的描述（如 `"Zod" (generated from schema.ts)`）
 */
export function formatZodScriptValidationErrors(
  issues: ZodScriptValidationResult,
  _content: string,
  sourceLabel: string,
): string[] {
  const errors: string[] = [];
  if (issues.typeExport) {
    errors.push(
      `  - Contains export type ...: TypeScript syntax is not valid JavaScript and will cause a SyntaxError.
    Remove all export type lines from the script (if schema.ts exists, remove them from schema.ts —
    types are implicitly handled by the build process).`,
    );
  }
  if (errors.length > 0) {
    errors.unshift(`Zod script ${sourceLabel} contains code that will fail at runtime:`);
  }
  return errors;
}

/**
 * 判断 first_messages 中的值是否为文件路径引用（非内联文本）
 * 与 resolveInlineOrFile (build.ts) 的判定条件一致：
 * 不含换行符 且 匹配已知文件扩展名
 */
export function isFilePathGreeting(value: string): boolean {
  return !value.includes('\n') && /\.(txt|md|json|yaml|yml|html)$/.test(value);
}

/**
 * 从开场白内容中提取 <UpdateVariable><initvar> 块的 YAML 内容
 *
 * 内容会先做换行符标准化（\r\n → \n），与 readFileText 一致，
 * 确保正则只需匹配 \n 即可覆盖 Windows 换行。
 *
 * 移除块时尽量保留原始排版：只删除块本身及其紧邻的一个换行，
 * 不会吞噬块前后的多个空行，也不会在块位置插入额外换行。
 *
 * @returns { initvarYaml: string, cleanedContent: string } 或 null（无块时）
 */
export function extractInitvarOverrideFromGreeting(content: string): { initvarYaml: string; cleanedContent: string } | null {
  // 标准化换行符，与 readFileText (file_io.ts) 处理方式一致
  const normalized = content.replace(/\r\n/g, '\n');

  const blockRe = /<UpdateVariable>\s*\n<initvar>\s*\n([\s\S]*?)\n<\/initvar>\s*\n<\/UpdateVariable>/;
  const match = normalized.match(blockRe);
  if (!match) return null;
  const initvarYaml = match[1];

  // 精确删除块及其紧邻的尾部空行（若存在），不误伤文档其他位置的空行
  const afterBlock = normalized.slice(match.index! + match[0].length);
  const trailingBlank = afterBlock.match(/^(\n[ \t]*\n)/);
  const removeEnd = match.index! + match[0].length + (trailingBlank ? trailingBlank[0].length : 0);
  const cleaned = (normalized.slice(0, match.index!) + normalized.slice(removeEnd)).trimEnd();
  return { initvarYaml, cleanedContent: cleaned };
}

/**
 * 在开场白内容中嵌入 <UpdateVariable><initvar> 块
 * 先删除已有块，再追加新块
 */
export function embedInitvarOverrideInGreeting(content: string, initvarYaml: string): string {
  const cleaned = extractInitvarOverrideFromGreeting(content)?.cleanedContent ?? content;
  return `${cleaned}\n\n<UpdateVariable>\n<initvar>\n${initvarYaml}\n</initvar>\n</UpdateVariable>`;
}

/**
 * 从 entryManifest 中定位 [InitVar] 条目对应的 YAML 文件绝对路径
 * @returns 绝对路径；未找到 [InitVar] 条目或条目无 path 时返回 null
 */
export function resolveInitvarPath(entryManifest: EntryManifest, projectDir: string): string | null {
  for (const typeEntries of Object.values(entryManifest)) {
    for (const [name, leaf] of Object.entries(typeEntries)) {
      if (/^\[InitVar\]/i.test(name) && leaf.path) {
        return resolve(projectDir, leaf.path);
      }
    }
  }
  return null;
}

/**
 * 加载 schema.ts 并导出 Zod Schema 实例
 * jiti + 全局注入 z/_ 只需初始化一次，后续可复用 Schema 实例校验多个 initvar 文件
 *
 * @returns Schema 实例
 * @throws schema.ts 不存在、预检失败或导出无效时抛出 Error
 */
export async function loadMvuSchema(
  schemaPath: string,
  options?: { schemaContent?: string },
): Promise<z.ZodType> {
  if (!existsSync(schemaPath)) {
    throw new Error(`schema.ts not found: ${schemaPath}`);
  }

  const schemaContent = options?.schemaContent ?? readFileText(schemaPath);
  const schemaImportErrors = checkSchemaTsContent(schemaContent);
  if (schemaImportErrors.length > 0) {
    throw new Error(schemaImportErrors.join('\n'));
  }

  const jiti = createJiti(import.meta.url, { interopDefault: true });

  const globalZ = globalThis as Record<string, unknown>;
  if (!globalZ.z) globalZ.z = z;
  if (!globalZ._) globalZ._ = _;

  const { Schema } = await jiti.import(schemaPath) as { Schema: z.ZodType };
  if (!Schema) {
    throw new Error('schema.ts does not export Schema');
  }

  return Schema;
}

/**
 * 用已加载的 Schema 实例校验单个 initvar 文件
 *
 * @returns 校验结果；schemaPath 不存在时返回 null
 * @throws 校验失败时抛出 Error
 */
export function validateInitvarWithSchema(
  schema: ZodType,
  initvarPath: string,
): { initvarPath: string } {
  if (!existsSync(initvarPath)) {
    throw new Error(`initvar file not found: ${initvarPath}`);
  }

  let initvarData: unknown;
  try {
    initvarData = yaml.parse(readFileText(initvarPath));
  } catch (e) {
    throw new Error(
      `Failed to parse initvar YAML at ${initvarPath}:\n  ${(e as Error).message}`,
    );
  }
  try {
    detailedParse(schema, initvarData);
  } catch (e) {
    throw new Error(`Validation failed for ${initvarPath}:\n` + (e as Error).message.split('\n').slice(1).join('\n'));
  }

  return { initvarPath };
}

/**
 * 校验 initvar 与 schema.ts 的一致性
 *
 * initvar 路径优先级：
 * 1. initvarOverride — CLI --initvar 指定（用于校验额外开场白的 initvar_override 文件，
 *    如 开场白/initvar/1.yaml。此类文件不在 entryManifest 中，只能显式指定）
 * 2. entryManifest 中 [InitVar] 条目的 path — 默认 initvar
 *
 * 支持通过 options.schema 传入已加载的 Zod Schema 实例，避免多次 jiti 初始化
 * （pack 流程需校验多个 initvar_overrides，应先用 loadMvuSchema 加载一次再循环调用）。
 *
 * @returns 校验结果；schema.ts 不存在时返回 null
 * @throws 校验失败时抛出 Error
 */
export async function validateMvuInitvar(
  projectDir: string,
  entryManifest: EntryManifest,
  initvarOverride?: string,
  options?: { schemaContent?: string; schemaPath?: string; schema?: ZodType },
): Promise<{ schemaPath: string; initvarPath: string } | null> {
  const schemaPath = options?.schemaPath ?? resolve(projectDir, 'schema.ts');
  if (!existsSync(schemaPath)) return null;

  const initvarPath = initvarOverride
    ? resolve(projectDir, initvarOverride)
    : resolveInitvarPath(entryManifest, projectDir);

  if (!initvarPath) {
    throw new Error('Cannot find [InitVar] entry path in entryManifest; use --initvar to specify');
  }

  // 加载 Schema：优先复用已加载实例，否则自行加载（含 import 预检）
  const schema = options?.schema ?? await loadMvuSchema(schemaPath, { schemaContent: options?.schemaContent });

  const result = validateInitvarWithSchema(schema, initvarPath);
  return { schemaPath, ...result };
}
