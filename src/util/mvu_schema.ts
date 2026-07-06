import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti/static';
import * as z from 'zod';
import * as _ from 'lodash';
import * as yaml from 'yaml';
import { readFileText } from './file_io.js';
import { detailedParse } from './prettified_parse.js';
import type { EntryManifest } from '../type/state.js';

/** jsdelivr CDN 路径（不含域名），用于检测 Zod 脚本 */
const MVU_ZOD_CDN_PATH = 'StageDog/tavern_resource/dist/util/mvu_zod.js';

/** registerMvuSchema 的默认 import URL */
const DEFAULT_MVU_ZOD_IMPORT_URL = `https://testingcf.jsdelivr.net/gh/${MVU_ZOD_CDN_PATH}`;

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

/**
 * 从 tavern_helper.scripts 中找出第一个启用的 Zod 脚本，提取其 CDN URL
 *
 * @param scripts scripts 记录（key 为脚本名，value 含 content / enabled / script_file）
 * @param resolveContent 可选：如何从 script 条目中获取内容
 *   - 不传时取 script.content
 *   - 传时可用于处理 script_file → file content 等场景
 * @returns 第一个找到的 Zod 脚本的 import URL；未找到返回 undefined
 */
export function detectFirstZodImportUrl(
  scripts: Record<string, any> | undefined | null,
  resolveContent?: (script: any) => string | undefined,
): string | undefined {
  if (!scripts) return undefined;
  for (const script of Object.values(scripts)) {
    if (script.enabled === false) continue;
    const content = resolveContent ? resolveContent(script) : script.content;
    if (content && isMvuZodScript(content)) {
      return detectMvuZodImportUrl(content);
    }
  }
  return undefined;
}

/** 检测脚本内容是否为 MVU Zod schema 脚本（Zod 版特有） */
export function isMvuZodScript(content: string): boolean {
  // 使用路径而非完整 URL 检测，兼容不同 jsdelivr CDN 域名
  if (!content.includes('registerMvuSchema')
      || !content.includes(MVU_ZOD_CDN_PATH)) {
    return false;
  }

  // 从 import 语句中提取 registerMvuSchema 的调用名（可能被别名）
  // 手写格式：import { registerMvuSchema } 或 import { registerMvuSchema as alias }
  // 压缩格式：import{registerMvuSchema as e}
  const importMatch = content.match(
    /import\s*\{[^}]*registerMvuSchema\s+(?:as\s+(\w+))?[^}]*\}/
  );
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

  return [
    `import { registerMvuSchema } from '${url}';`,
    ...filtered,
    '',
    '$(() => {',
    `  registerMvuSchema(${schemaVar});`,
    '});',
  ].join('\n');
}

/** resolveSchemaSyncInput 的产物：pack 流程同步/校验 Zod 脚本所需的全部输入 */
export interface SchemaSyncInput {
  /** schema.ts 文件内容 */
  schemaContent: string;
  /** 从现有 Zod 脚本中检测出的 registerMvuSchema CDN URL（用于保留 CDN 域名） */
  detectedImportUrl: string | undefined;
  /** buildZodScriptFromSchemaTs 同步生成的 Zod 脚本内容，供校验复用 */
  zodSubject: string;
}

/**
 * 为 pack 流程准备 schema.ts 同步所需的全部输入，避免 build/index 两处各自重复读盘、重复 detect。
 *
 * @param stateDir state.json 所在目录
 * @param scripts tavern_helper.scripts 记录；可含 script_file 或内联 content
 * @param resolveContent 可选：如何从 script 条目取内容（用于 script_file → file content 场景）。
 *   不传时取 script.content（适用于调用方已把 script_file 解析进 content 的情况）。
 * @returns schema.ts 不存在返回 undefined；否则返回一次性计算好的同步输入
 */
export function resolveSchemaSyncInput(
  stateDir: string,
  scripts: Record<string, any> | undefined,
  resolveContent?: (script: any) => string | undefined,
): SchemaSyncInput | undefined {
  const schemaTsPath = resolve(stateDir, 'schema.ts');
  if (!existsSync(schemaTsPath)) return undefined;
  const schemaContent = readFileText(schemaTsPath);

  const detectedImportUrl = detectFirstZodImportUrl(scripts, resolveContent);
  const zodSubject = buildZodScriptFromSchemaTs(schemaContent, detectedImportUrl);
  return { schemaContent, detectedImportUrl, zodSubject };
}

/**
 * 检测 Zod 脚本是否为压缩/编译产物
 * 压缩脚本的特征：sourceMappingURL、import 别名、单行超长代码
 */
export function isMinifiedZodScript(content: string): boolean {
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
  /** 是否发现 `import ... from 'zod'` 或 `import 'zod';`（side-effect）类问题——
   *  裸模块标识符无法在浏览器中解析，仅含 zod 而无论 `from` 是否存在。 */
  bareZodImport: boolean;
  /** 是否发现 `import ... from 'lodash'` 或 `import 'lodash';`（side-effect）类问题——
   *  裸模块标识符无法在浏览器中解析，仅含 lodash 而无论 `from` 是否存在。 */
  bareLodashImport: boolean;
  /** 是否发现 export type ... 类问题（TypeScript 语法不是合法 JavaScript） */
  typeExport: boolean;
  /** 非 URL 的其他 import（裸模块、相对路径、绝对路径等）。
   *  注意：zod / lodash 已在 bareZodImport / bareLodashImport 单独处理，此处不包含。 */
  otherImports: Array<{ specifier: string; statement: string }>;
}

/** 从字符串内容中提取所有裸引入指定包的 import 语句，覆盖两种形式：
 *  - 命名/具名 import：`import { z } from 'zod'`、`import z from 'zod'`
 *  - side-effect import：`import 'zod';`（无 `from`）
 *  允许行首空白；支持跨多行的 import 语句（如 `import {\n  z\n} from 'zod'`）；
 *  单行内 `;` 分隔的多条语句仅捕获从行首起的那一条。 */
function extractBareImports(content: string, pkg: string): string[] {
  const re = new RegExp(`^\\s*import\\s+(?:[\\s\\S]*?\\bfrom\\s+)?['"]${pkg}['"];?`, 'gm');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    // 压缩多行 import 的换行/空白，便于错误信息单行展示
    out.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * 校验 Zod 脚本内容是否含有会导致运行时失效的模式
 * - import ... from 'zod' → 裸模块标识符无法在浏览器中解析
 * - import ... from 'lodash' → 同上
 * - export type ... → TypeScript 语法不是合法 JavaScript
 * - 其他非 URL 的 import（bare / relative / absolute）→ 无对应资源
 *
 * **校验时机**：
 * - schema.ts 存在时：用 buildZodScriptFromSchemaTs 同步生成 Zod 脚本内容后再校验。
 *   此时 typeExport 不会触发（buildZodScriptFromSchemaTs 移除了所有 export type 行），
 *   但 bareZodImport / bareLodashImport 仍有效——schema.ts 自身若含裸 import，
 *   同步后的脚本会原样保留，运行时崩溃。
 * - schema.ts 不存在时：校验磁盘上的 脚本/Zod.txt 原样内容，所有检查均有效。
 */
export function validateZodScriptContent(content: string): ZodScriptValidationResult {
  // 以 extractBareImports 为单一来源，避免检测与提取两套正则行为不一致
  const bareZodImport = extractBareImports(content, 'zod').length > 0;
  const bareLodashImport = extractBareImports(content, 'lodash').length > 0;
  const typeExport = /^export\s+type\s+/m.test(content);

  // 提取所有非 URL import，排除已在 bareZodImport / bareLodashImport 覆盖的包。
  // 支持 import ... from 'pkg' 与 import 'pkg' 两种形式，以及跨多行的 import 语句。
  const otherImports: Array<{ specifier: string; statement: string }> = [];
  const importRe = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;
  const seen = new Set<string>();
  for (let m = importRe.exec(content); m; m = importRe.exec(content)) {
    const specifier = m[1];
    if (/^https?:\/\//.test(specifier) || /^\/\//.test(specifier)) continue;
    if (specifier === 'zod' || specifier === 'lodash') continue;
    // deduplicate by specifier
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    // 压缩多行 import 的换行/空白，便于错误信息单行展示
    otherImports.push({ specifier, statement: m[0].replace(/\s+/g, ' ').trim() });
  }

  return { bareZodImport, bareLodashImport, typeExport, otherImports };
}

/**
 * 将 ZodScriptValidationResult 格式化为用户可见的错误信息
 *
 * @param issues  校验结果
 * @param content 原始脚本内容（用于提取具体 import 行）
 * @param sourceLabel 被校验来源的描述（如 `"Zod" (generated from schema.ts)`）
 */
export function formatZodScriptValidationErrors(
  issues: ZodScriptValidationResult,
  content: string,
  sourceLabel: string,
): string[] {
  const errors: string[] = [];
  if (issues.bareZodImport) {
    const stmts = extractBareImports(content, 'zod');
    const sample = stmts.length > 0 ? ` (found: ${stmts.map(s => s.trim()).join(' | ')})` : '';
    errors.push(
      `  - Contains import from 'zod'${sample}: bare module specifier cannot be resolved by the browser.
    Remove this import — z is already available as a global provided by the MVU runtime.
    Note: if your editor reports "Cannot find module 'zod'", that is expected;
    do NOT run 'npm install zod', simply delete the import.`,
    );
  }
  if (issues.bareLodashImport) {
    const stmts = extractBareImports(content, 'lodash');
    const sample = stmts.length > 0 ? ` (found: ${stmts.map(s => s.trim()).join(' | ')})` : '';
    errors.push(
      `  - Contains import from 'lodash'${sample}: bare module specifier cannot be resolved by the browser.
    Remove this import — _ is already available as a global provided by the MVU runtime.
    Do NOT run 'npm install lodash'.`,
    );
  }
  if (issues.otherImports.length > 0) {
    for (const { specifier, statement } of issues.otherImports) {
      errors.push(
        `  - Contains import from '${specifier}' (found: ${statement}):
    '${specifier}' is not a valid URL import. Only CDN URL imports (https://...) are allowed;
    forge does not bundle external packages. Remove this import.`,
      );
    }
  }
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
 * 从开场白内容中提取 <UpdateVariable><initvar> 块的 YAML 内容
 *
 * 内容会先做换行符标准化（\r\n → \n），与 readFileText 一致，
 * 确保正则只需匹配 \n 即可覆盖 Windows 换行。
 *
 * @returns { initvarYaml: string, cleanedContent: string } 或 null（无块时）
 */
export function extractInitvarOverrideFromGreeting(content: string): { initvarYaml: string; cleanedContent: string } | null {
  // 标准化换行符，与 readFileText (file_io.ts) 处理方式一致
  const normalized = content.replace(/\r\n/g, '\n');

  const match = normalized.match(/<UpdateVariable>\s*\n<initvar>\s*\n([\s\S]*?)\n<\/initvar>\s*\n<\/UpdateVariable>/);
  if (!match) return null;
  const initvarYaml = match[1];
  // 删除块及其前后的空行
  const cleaned = normalized.replace(/\s*<UpdateVariable>\s*\n<initvar>\s*\n[\s\S]*?\n<\/initvar>\s*\n<\/UpdateVariable>\s*/, '\n').trimEnd();
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
 * 校验 initvar 与 schema.ts 的一致性
 *
 * initvar 路径优先级：
 * 1. initvarOverride — CLI --initvar 指定（用于校验额外开场白的 initvar_override 文件，
 *    如 开场白/initvar/1.yaml。此类文件不在 entryManifest 中，只能显式指定）
 * 2. entryManifest 中 [InitVar] 条目的 path — 默认 initvar
 *
 * @returns 校验结果；schema.ts 不存在时返回 null
 * @throws 校验失败时抛出 Error
 */
export async function validateMvuInitvar(
  projectDir: string,
  entryManifest: EntryManifest,
  initvarOverride?: string,
  options?: { schemaContent?: string },
): Promise<{ schemaPath: string; initvarPath: string } | null> {
  const schemaPath = resolve(projectDir, 'schema.ts');
  if (!existsSync(schemaPath)) return null;

  const initvarPath = initvarOverride
    ? resolve(projectDir, initvarOverride)
    : resolveInitvarPath(entryManifest, projectDir);

  if (!initvarPath) {
    throw new Error('Cannot find [InitVar] entry path in entryManifest; use --initvar to specify');
  }
  if (!existsSync(initvarPath)) {
    throw new Error(`initvar file not found: ${initvarPath}`);
  }

  // Pre-check: schema.ts must not contain import statements.
  // 调用方已读好 schema.ts 内容时可经 options 传入以避免重复读盘（pack 流程需校验多个
  // initvar_overrides）；CLI 入口 validate-mvu 不传则内部自行读盘，保持自包含。
  const schemaContent = options?.schemaContent ?? readFileText(schemaPath);
  const schemaImportErrors = checkSchemaTsContent(schemaContent);
  if (schemaImportErrors.length > 0) {
    throw new Error(schemaImportErrors.join('\n'));
  }

  const jiti = createJiti(import.meta.url, { interopDefault: true });

  const globalZ = globalThis as Record<string, unknown>;
  globalZ.z = z;
  globalZ._ = _;

  const { Schema } = await jiti.import(schemaPath) as { Schema: z.ZodType };

  if (!Schema) {
    throw new Error('schema.ts does not export Schema');
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
    detailedParse(Schema, initvarData);
  } catch (e) {
    throw new Error(`Validation failed for ${initvarPath}:\n` + (e as Error).message.split('\n').slice(1).join('\n'));
  }

  return { schemaPath, initvarPath };
}
