# 机制原理

## 目录

- [configure 推导算法](#configure-推导算法)
  - [验证阶段](#验证阶段)
  - [策略推导](#策略推导)
  - [位置推导](#位置推导)
  - [排序分配](#排序分配)
  - [UID 分配](#uid-分配)
  - [递归默认值](#递归默认值)
- [patch 机制](#patch-机制)
  - [预检查](#预检查)
  - [文件自动重命名](#文件自动重命名)
  - [备份与回滚](#备份与回滚)
  - [验证提醒](#验证提醒)
- [格式检测](#格式检测)
- [MVU 支持](#mvu-支持)
  - [MVU 检测](#mvu-检测)
  - [pack 时 MVU 校验](#pack-时-mvu-校验)
  - [Zod 脚本同步](#zod-脚本同步)
  - [initvar_override 嵌入与提取](#initvar_override-嵌入与提取)
- [编码检测](#编码检测)

## configure 推导算法

configure 命令根据 `tavern-cards-state.json` 中的配置推导并填充条目的运行时字段。仅基于 state.json 内已有的值，不读取 `.cardrc.json`。

执行顺序：验证 → 策略推导 → 位置推导 → 排序分配 → UID 分配。

### 验证阶段

configure 首先验证 state.json 内部配置完整性，任何错误都会阻止后续推导。如果 `typeLists` 或 `strategyThresholds` 为空，提示先运行 `init` 命令：

1. **typeLists 完整性**：entryManifest 中出现的每个类型都必须在 `state.typeLists` 的三个区域之一中列出。`unknown` 类型特殊处理：报错"发现 N 条未分类条目，请在 entryManifest 中整理条目类型"
2. **strategyThresholds 完整性**：除 `unknown` 外，每个类型都必须在 `state.strategyThresholds` 中有对应条目。嵌套类型还需覆盖该类型下所有出现的 part
2. **strategyThresholds 完整性**：除 `unknown` 外，每个类型都必须在 `state.strategyThresholds` 中有对应条目。嵌套类型还需覆盖该类型下所有出现的 part
3. **partOrder 完整性**：有 part 的类型都必须有 `state.partOrder` 配置，且覆盖所有出现的 part

**验证失败示例：**

```
Validation FAILED:
  - state.strategyThresholds 为空，请先运行 init 命令
  - 发现 50 条未分类条目 (类型: unknown)，请在 entryManifest 中整理条目类型
  - strategyThresholds 缺少类型 "自定义类型" 的阈值配置
```

### 策略推导

每个条目的策略由阈值和同组条目数量共同决定。阈值来源：`state.strategyThresholds[typeName]`。

**阈值类型**：

| 阈值类型 | 配置示例 | 说明 |
|---------|---------|------|
| 简单值 | `"Infinity"`, `0`, `5`, `null` | 整个类型统一阈值 |
| 嵌套值 | `{ "basic": { "threshold": 5, "required": true } }` | 按 part 分别配置阈值 |

**阈值语义**：

| 阈值 | 推导结果 |
|------|---------|
| `"Infinity"` 或 `-1` | 始终 constant（蓝灯） |
| `0` | 始终 selective（绿灯），需 keywords 非空 |
| `> 0` | count >= threshold → selective；否则 constant |
| `null` | enabled = false |
| `undefined`（未配置） | enabled = false |

**条目计数规则**：

计数范围：嵌套阈值时取 required part 的条目数（多个 required part 条目数不同时报错）；无 required part 时取同类型内所有非 catalog 条目数；简单阈值时取同类型内所有非 catalog 条目数。仅计算非 `rephrase` 条目（排除 `scope=catalog` 的条目）：

- 非 EJS 条目各算 1
- EJS 条目（`contents` 首片段 `content` 以 `@@if ` 开头）合计只算 1
- 当 `required: true` 时，只计算非 EJS 条目（EJS 是条件加载的，不算 required）

**特殊规则**：

- `scope=catalog`：始终 constant，不参与计数
- `rephrase`：使用与同组非 rephrase 条目相同的阈值和计数走推导，结果自然一致
- `enabled=false`：跳过推导
- 条件阈值（> 0 且非 Infinity）下 `scope` 未设置时，输出警告但仍继续推导

### 位置推导

根据类型在 `state.typeLists` 中的区域推导位置：

| typeLists 区域 | 推导的 position.type |
|---------------|---------------------|
| `before_char` | `before_character_definition` |
| `after_char` | `after_character_definition` |
| `depth` | `at_depth`（role/depth 取 `state.depth_defaults`） |

- `at_depth` 的 `role` 和 `depth` 默认值来自 `state.depth_defaults`（默认 `role: "system"`, `depth: 0`）
- `rephrase` 条目：始终 `at_depth`，无论其类型在哪个区域

### 排序分配

使用 tens-group 算法分配 `position.order`，确保不同组之间有间隔：

1. **条目遍历顺序**：按 typeLists 的区域顺序（before_char → after_char → depth）遍历各类型，再遍历未在 typeLists 中出现的类型
2. **分组规则**：
   - 跨类型 → 自动新十位块
   - 无 part 的类型 → 同类型内同一十位块（纯类型名分组）
   - 有 part 的类型 → token 重叠分组算法（见下）
3. **order 分配**：
   - 同组内连续递增（10, 11, 12, ...）
   - 换组时跳到下一个整十（nextTens）
   - `rephrase` 条目 → 反序排列，放在所有常规条目之后

**token 重叠分组算法**：有 part 的类型（如 `角色`、`地理`）内，通过条目名称和 keywords 的 token 重叠检测决定是否归入同一十位块：

- **token 来源**：条目名称按分隔符（`-`、`_`、空格、`/`）分词 + `leaf.keywords`
- **同 part**：检查与累积 token 集的重叠，重叠则同组，否则新十位块（不累积自身 token）
- **不同 part**：检查重叠，重叠则同组并累积 token，否则新十位块
- **跨类型**：自动新十位块，重置累积集

**示例**：假设有 EJS预处理(1条)、世界观(1条)、角色(3条 林小雨 + 2条 张三)、MVU(2条)

```
EJS预处理           → order: 10
世界观               → order: 20
林小雨_基本信息      → order: 30
林小雨_性格          → order: 31  (同组: "林小雨" 重叠)
林小雨_其他          → order: 32  (同组: "林小雨" 重叠)
张三_基本信息        → order: 40  (新组: 同 part 无重叠)
张三_性格            → order: 41  (同组: "张三" 重叠)
(如有 rephrase)     → order: 50, 51, ... (反序)
MVU变量列表         → order: 60
MVU更新规则         → order: 61
```

### UID 分配

自动分配唯一数字 ID，避免与已有 UID 冲突。仅当 `force` 或条目未设置 `uid` 时写入。

### 递归默认值

条目的 `recursion` 不再由 configure 写入。默认行为（`prevent_incoming: true, prevent_outgoing: true`）在 pack 时自动补回，unpack 时自动省略。如果条目需要不同的递归设置，手动在 state.json 中设置 `recursion` 字段。

## patch 机制

### 预检查

在应用 patch 之前，precheck 验证所有文件路径相关的操作：

- **`add` 操作**：涉及文件路径字段时验证文件存在
- **`replace` 操作**：验证源文件存在、目标文件不存在
- **条目重命名检测**：`move` 操作重命名条目时发出提醒

precheck 失败会阻止 patch 执行，避免文件系统进入不一致状态。

### 文件自动重命名

当 `replace` 操作修改文件路径字段时，patch 会自动执行文件重命名：

1. 验证源文件存在
2. 验证目标路径不存在同名文件
3. 执行文件系统 rename
4. 更新 state.json 中的路径字段

**不要提前手动重命名文件**，否则 precheck 会因源文件不存在而失败。

### 备份与回滚

每次 patch 执行前创建备份：

- 备份位置：`.patch-history/{project}/{timestamp}.json`
- 可通过 `--no-backup` 跳过

**回滚机制**：

1. 如果 JSON Patch 应用后 schema 验证失败，自动回滚：
   - 撤销已执行的文件 rename 操作
   - 恢复备份的 state.json
2. 确保文件系统与 state.json 保持一致

### 验证提醒

patch 应用后执行与 configure 相同的配置完整性检查，但不阻断操作：

- 检查 typeLists/strategyThresholds/partOrder 完整性
- 仅输出警告，不阻止写入

## 格式检测

unpack 时自动识别输入文件格式：

1. **PNG 文件** → 角色卡格式
   - 提取 tEXt chunk 中的 `chara` 和 `ccv3` 数据
   - `form = "charactercard"`
2. **JSON 文件** → 根据结构判断：
   - 有 `spec` 字段（如 `"spec": "chara_card_v3"`）→ 角色卡 JSON
   - 有 `entries` 对象且第一个条目包含 `order` 字段 → 扁平格式世界书
   - 有 `entries` 数组 → SillyTavern 标准格式世界书
   - `form` 根据检测结果自动设置

pack 时根据 `form` 和 `avatar` 字段选择输出格式：

| 条件 | 输出格式 |
|------|---------|
| `form=worldbook` | 扁平格式 JSON |
| `form=charactercard` + `avatar` 非空 | PNG（嵌入 chara/ccv3 tEXt chunk） |
| `form=charactercard` + `avatar` 为空 | 标准格式角色卡 JSON |

## MVU 支持

工具支持两种 MVU 方案：**MVU**（基于 MagVarUpdate 脚本）和 **MVU Zod**（基于 MagVarUpdate + Zod schema 变量校验，需同时使用两个脚本）。两者共享同一 `mvu` 字段和 [InitVar] 条目约定；initvar_override 机制对两种方案均有效。

### MVU 检测

**unpack** 和 **pack** 时均会检测角色卡的 MVU 特征，检测逻辑集中在 `src/util/detect_mvu.ts`。

- **unpack**：检测在 `characterMeta` 合并后、内容文件写出前执行（此时 `TavernHelperScript.content` 尚未被写出为文件，可直接检测内存中的内容）。满足条件时自动设置 `mvu = true`。
- **pack**：当 `state.mvu === true` 时触发校验。若 `tavern_helper.scripts` 使用了 `script_file`，pack 会先解析文件内容写入脚本对象，再调用 `detectMvu()` 验证，不满足条件则报错退出（不自动修正 `mvu`）。

**检测条件**（三个同时满足）：

1. `form === 'charactercard'`
2. 某个**已启用**（`enabled !== false`）的 `TavernHelperScript.content` 同时包含 `"import"` 和 `"MagicalAstrogy/MagVarUpdate"`
3. `entryManifest` 中存在以 `[InitVar]` 开头的条目名（不区分大小写）

### pack 时 MVU 校验

`state.mvu === true` 时 pack 依次执行以下校验，全部通过才继续打包：

1. **MVU 特征检测**（见上节） — 必须满足三个检测条件
2. **[InitVar] 条目禁用校验** — 所有以 `[InitVar]` 开头的条目必须显式设置 `enabled: false`（SillyTavern 默认启用，运行时不应激活这些仅用于变量定义的条目）
3. **schema.ts 预检** — 仅在项目根目录**有** `schema.ts` 时触发（[`checkSchemaTsContent`](../src/util/mvu_schema.ts)）：
   - `schema.ts` 不得包含任何 `import` 语句。`z`（Zod v4）与 `_`（lodash）已由 MVU 运行时作为全局注入，无需也不能 `import`；forge **不打包**额外 npm 包，因此裸模块 / 相对路径 / 绝对路径的 `import` 都会在浏览器解析阶段失败
   - 命中即整体终止并打印违法 import 列表，提示用户删除（**不要** `npm install`）
4. **Zod 脚本内容校验** — `schema.ts` 存在与否均触发（[`validateZodScriptContent`](../src/util/mvu_schema.ts)）：
   - `schema.ts` 存在时：用 [`buildZodScriptFromSchemaTs`](../src/util/mvu_schema.ts) 同步生成后的 Zod 脚本作为校验对象。此产物已剔除 `export type` 行，所以 `typeExport` 永不命中；但 `schema.ts` 自身的裸 `import`（如 `import { z } from 'zod'`、`import _ from 'lodash'`）会被原样保留进同步后的脚本，运行时崩溃，因此必须在校验前由步骤 3 拦截
   - `schema.ts` 不存在时：直接校验磁盘上 `脚本/{name}.txt`（即 `script.script_file` / `script.content` 指向的原样内容），`typeExport` 与各 import 检查均生效
   - 检查项（均会阻止打包）：
     - `import ... from 'zod'`：裸模块标识符（bare module specifier）无法在浏览器中解析；删除该 import，`z` 已作为 MVU 运行时全局
     - `import ... from 'lodash'`：同上，删除该 import，`_` 已作为全局
     - 其他**非 URL** import（裸模块名 / 相对路径 / 绝对路径）：仅有 `https://` / `//` 开头的 CDN URL import 合法
     - `export type ...`：TypeScript 语法不是合法 JavaScript，会触发 `SyntaxError`
   - 错误信息由 [`formatZodScriptValidationErrors`](../src/util/mvu_schema.ts) 渲染，会附带命中的具体 import 语句
5. **initvar 一致性校验** — 仅在项目根目录**有** `schema.ts` 时触发（[`validateMvuInitvar`](../src/util/mvu_schema.ts)）：
   - 校验 `entryManifest` 中 `[InitVar]` 条目的 YAML 内容是否匹配 `schema.ts` 定义的 Zod Schema
   - 校验 `initvar_overrides` 中所有 override YAML 文件同样匹配该 Schema
   - 内部先执行步骤 3 的 schema.ts import 预检；pack 流程已读好 `schema.ts` 内容时会经 `options.schemaContent` 传入，避免对每个 override 重复读盘

校验逻辑分布在 `src/util/detect_mvu.ts`（MVU 检测、禁用校验）和 `src/util/mvu_schema.ts`（Zod 脚本校验、initvar 一致性校验）。

### Zod 脚本同步

MVU Zod 方案中，`schema.ts` 是变量 Schema 的单一数据源，Zod 脚本（`tavern_helper.scripts` 中引用 `mvu_zod.js` 的脚本）从 `schema.ts` 自动生成。

**pack 方向**（`buildZodScriptFromSchemaTs`）：
1. [`resolveSchemaSyncInput`](../src/util/mvu_schema.ts) 一次性完成「读 `schema.ts` + 检测启用 Zod 脚本的 `registerMvuSchema` CDN import URL + 生成同步后 Zod 脚本内容」，供后续 [build](../src/pack/build.ts) 同步与 [pack/index.ts](../src/pack/index.ts) 校验复用，避免两步各自重复读盘 / 重复 detect
   - 检测 import URL 时同时支持 `script_file` 引用与内联 `content` 两种脚本表达方式（接受可选的 `resolveContent` 回调，调用方用它在循环外将 `script_file` 解析为文件内容，避免循环内重复读盘）
   - 多个启用 Zod 脚本时取第一个的 import URL；保留 URL 是为了透明保留不同 jsdelivr CDN 域名，避免默认域名覆盖项目自选域名
2. 生成 Zod 脚本内容：
   - 移除 `export type` 行（TypeScript 语法在浏览器中不合法）
   - 在顶部添加 `registerMvuSchema` 的 CDN import
   - 在底部添加 `$(() => { registerMvuSchema(Schema); });` 注册调用
3. 替换脚本的 `content` 字段为生成内容（`schema.ts` 不存在时原样透传）

**unpack 方向**（`extractSchemaTsFromScript`）：
1. 收集所有启用的 Zod 脚本（存在多个时取第一个，并警告其余可能被禁用）
2. 逆向提取 `schema.ts`：
   - 移除 `registerMvuSchema` 的 import 行
   - 移除 `$(() => { ... })` 注册块
   - 在文件末尾添加 `export type Schema = z.output<typeof Schema>;`
3. 写入 `schema.ts` 到项目根目录

**压缩/编译脚本处理**：若 Zod 脚本为压缩产物（包含 `sourceMappingURL`、import 别名或超长单行），`extractSchemaTsFromScript` 返回 `null`，unpack 跳过自动提取，提示用户手动编写 `schema.ts`。

### initvar_override 嵌入与提取

不同开场白（`first_messages`）可以携带独立的 initvar YAML，用于在开场白期间临时覆盖变量初始值。数据格式为 `<UpdateVariable><initvar>` 包裹的 YAML 块。`initvar_overrides` 字段以 `Record<开场白路径, override YAML 路径>` 形式记录映射。

**pack 方向**（`embedInitvarOverrideInGreeting`）：
1. 读取 `state.initvar_overrides[greetingKey]` 指向的 YAML 文件
2. 若开场白已有 `<UpdateVariable><initvar>` 块，先移除旧块
3. 在结尾追加新块：`\n\n<UpdateVariable>\n<initvar>\n{yaml内容}\n</initvar>\n</UpdateVariable>`

**unpack 方向**（`extractInitvarOverrideFromGreeting`）：
1. 检测开场白内容中的 `<UpdateVariable><initvar>` 块
2. 将 YAML 内容写入 `开场白/initvar/{index}.yaml`
3. 移除块后，清理后的内容写入 `开场白/{index}.txt`
4. 填充 `state.initvar_overrides["开场白/{index}.txt"] = "开场白/initvar/{index}.yaml"`

## 编码检测

所有文件读取通过 `readFileText` 函数（`src/util/file_io.ts`），自动检测文件编码：

1. **jschardet 检测**：读取 Buffer，用 jschardet 推断编码类型
2. **非 UTF-8 拦截**：
   - 置信度 ≥ 0.7 → 抛出 `EncodingError`，阻止操作（常见于 GBK/GB2312 文件）
   - 置信度 > 0 但 < 0.7 → 输出警告 `"Warning: ... may be GB2312 ..."`，不阻止读取
3. **BOM 剥离**：自动剥离 UTF-8 BOM（`EF BB BF`），修复 Windows 记事本默认添加 BOM 导致的 `﻿` 残留问题
4. **置换字符兜底**：文件过短无法检测时，检查 UTF-8 解码结果是否含 `�`（U+FFFD），含则报错

**常见触发场景**：中文 Windows 用户用默认 GBK（cp936）编码保存 `.txt` 文件。错误信息示例：

```
Encoding error: "世界书/角色基本.txt" is GB2312 (confidence: 99%), expected UTF-8.
Please re-save the file as UTF-8 and try again.
```

**注意**：JSON 文件（`tavern-cards-state.json`、`.cardrc.json`、patch 文件）要求 UTF-8，这是 JSON 标准规范，不在此检测范围内。
