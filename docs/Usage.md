# 使用指导

## 目录

- [安装与构建](#安装与构建)
- [命令](#命令)
  - [pack](#pack)
  - [unpack](#unpack)
  - [configure](#configure)
  - [init](#init)
  - [validate-mvu](#validate-mvu)
  - [query](#query)
  - [patch](#patch)
  - [export](#export)
  - [split](#split)
- [典型工作流](#典型工作流)

## 安装与构建

**直接运行单文件产物**：发布包中的 `dist/index.mjs` 已打包运行时依赖，只要本机有 Node.js 20+ 即可运行，无需 `npm install`。

```bash
node dist/index.mjs --help
chmod +x dist/index.mjs && ./dist/index.mjs --help   # 或添加可执行权限后直接调用
```

**从源码构建**（开发或重新构建）：

```bash
npm install
npm run build          # tsup → dist/index.mjs（单文件 bundled CLI）
npm link && tavern-cards-forge --help   # 或全局链接后用命令名调用
```

## 命令

所有命令的第一个参数 `<project>` 通常填写 `.cardrc.json` 中 `projects` 的 key。若不想注册项目，也可以使用占位符，并通过路径选项直接指定输入/输出：

- **只需要 state 路径的命令**：configure、init、validate-mvu、query、patch — 提供 `--state` 后，`<project>` 可写成任意占位符。
- **需要同时指定输入和输出的命令**：pack — 需要 `--state` + `--output`；unpack — 需要 `--file`，且必须提供 `--state`（merge 模式，`--output` 可从 `--state` 推导）或 `--fresh`（全新解包，同时需 `--output`）之一；此时 `<project>` 也只作为占位符。

### pack

将 `tavern-cards-state.json` 打包为 SillyTavern 格式。

```
tavern-cards-forge pack <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径；与 `--output` 配合可跳过项目查找 |
| `--output <path>` | 覆盖输出产物路径；未注册项目时与 `--state` 配合必需 |

**行为：**

1. 读取 `state_file` 指向的 `tavern-cards-state.json`
2. **验证所有文件路径字段**存在（`entryManifest` 的 `path`/`contents[].file`、`regex_scripts.replace_file`、`tavern_helper.scripts.script_file`、`avatar`、`first_messages[]`、`initvar_overrides` 值、`zod.schemaPath`）；缺失则列出清单退出
3. 读取所有内容文件并检测编码（非 UTF-8 报错，详见 [机制原理](Mechanisms.md#编码检测)）
4. MVU 项目（`state.mvu === true`）额外执行 [InitVar] 条目禁用校验、Zod 脚本重建与内容校验、initvar YAML 与 `schema.ts` 的一致性校验（详见 [机制原理](Mechanisms.md#pack-时-mvu-校验)）；`state.zod` 缺失时输出警告并跳过 Zod 校验
5. 将 EntryManifestLeaf 转换为 SillyTavern 原始格式；`initvar_overrides` 存在时嵌入开场白的 `<UpdateVariable><initvar>` 块
6. 根据 `form` + `avatar` 选择输出格式：
   - `form=worldbook` → 独立世界书 JSON（扁平格式）
   - `form=charactercard` + `avatar` 非空 → PNG（avatar 非合法 PNG 时回退 JSON 并警告）
   - `form=charactercard` + `avatar` 为空 → 角色 JSON 卡
7. 输出路径优先级：`--output` > 项目 `artifact` > state 同目录的 `{name}.json`/`.png`；后缀与实际格式不符时自动修正并警告

**示例：**

```bash
# 通过注册项目打包
tavern-cards-forge pack <project>

# 覆盖输出路径
tavern-cards-forge pack <project> --output ./dist/MyCharacter.png

# 未注册项目时，使用占位符并同时提供输入和输出
tavern-cards-forge pack temp \
  --state ./cards/MyCharacter/tavern-cards-state.json \
  --output ./dist/MyCharacter.png
```

### unpack

将 SillyTavern PNG/JSON 还原为 `tavern-cards-state.json` + 内容文件。

```
tavern-cards-forge unpack <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--file <path>` | 直接指定输入 PNG/JSON 路径；未注册项目时必需 |
| `--output <dir>` | 覆盖输出目录；merge 模式下可从 `--state` 推导；`--fresh` 模式下未注册项目时必需 |
| `--state <path>` | 指定已有 state.json 路径用于合并（merge 模式）；与 `--fresh` 互斥；`--output` 未指定时默认取其所在目录 |
| `--json` | 从 PNG 提取角色卡 JSON（仅支持 PNG 输入） |
| `--fresh` | 跳过与已有 state 合并，直接覆盖输出（全新解包）；与 `--state` 互斥 |

**行为：**

1. 读取 `artifact` 指向的 PNG/JSON 文件，自动识别格式（PNG → 角色卡；JSON → 检测扁平格式独立世界书或 `character_book` 嵌套格式角色卡）
2. 提取所有条目转换为扁平 EntryManifestLeaf；MVU 项目自动设置 `mvu: true`、从 `tavern_helper.scripts` 检测并提取 Zod 脚本元数据写入 `state.zod`（详见 [机制原理](Mechanisms.md#mvu-检测)）；角色卡的 description、first_messages 写入 state；personality、scenario、mes_example、system_prompt、post_history_instructions、tags 非空时写入（空值缺省，pack 时按空值写回卡内）
3. **merge 模式**（默认）：与 `--state` 指向的旧 state 合并——条目先按名匹配，再按归一化内容匹配检测重命名；新卡不存在的旧条目文件保留不删除。`--output` 未指定时从 `--state` 路径推导
4. **条目内容落盘**：fresh 模式按内容格式自动判定 `{name}.yaml` / `contents` 片段 / `{name}.txt`；merge 模式保留旧文件名主体、仅按新格式调整后缀。同名文件加 `_1`/`_2` 后缀；存储方式变更时输出警告
5. `regex_scripts` 写入 `正则/{name}.txt`；`tavern_helper.scripts` 普通脚本写入 `脚本/{name}.txt`（Zod 脚本已在步骤 2 提取）；`first_messages` 写入 `开场白/0.txt`、`1.txt`...，MVU 项目额外提取 `<UpdateVariable><initvar>` 块为独立 YAML 并填充 `initvar_overrides`（详见 [机制原理](Mechanisms.md#initvar_override-嵌入与提取)）
6. 生成 `tavern-cards-state.json`（按输入类型设置 `form`）；输出目录优先级：`--output` > `--state` 所在目录（merge） > `state_file` 所在目录 > 当前目录下以文件名命名的目录

**示例：**

```bash
# 通过注册项目解包
tavern-cards-forge unpack <project>

# 未注册项目时，merge 模式（--output 可从 --state 推导）
tavern-cards-forge unpack temp \
  --file ./MyCharacter.png \
  --state ./MyCharacter-project/tavern-cards-state.json

# 未注册项目时，全新解包（需同时指定 --file 和 --output）
tavern-cards-forge unpack temp \
  --file ./MyCharacter.png \
  --output ./MyCharacter-project \
  --fresh

# 提取角色卡 JSON
tavern-cards-forge unpack <project> --json
```

### configure

根据 `tavern-cards-state.json` 中的配置推导并填充条目的运行时字段。仅基于 state.json 内已有的值，不读取 `.cardrc.json`。

```
tavern-cards-forge configure <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径（跳过项目查找） |
| `--force` | 强制覆盖已有值（默认仅填充缺失字段） |

**示例：**

```bash
tavern-cards-forge configure <project>
tavern-cards-forge configure <project> --force
```

**填充模式：**

- **默认模式**：仅填充缺失字段（已有值保持不变）
- **`--force` 模式**：覆盖所有推导字段（strategy、position、order）

推导的具体算法（验证规则、策略推导、位置推导、排序分配）详见 [机制原理](Mechanisms.md#configure-推导算法)。

### init

从 `.cardrc.json` 读取默认配置写入 `tavern-cards-state.json`。如果项目文件夹或 state.json 不存在，自动创建。

```
tavern-cards-forge init <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径（跳过项目查找） |
| `--worldbook` | 创建或更新为独立世界书项目（`form: "worldbook"`, `mvu: false`） |
| `--mvu` | 创建或更新为 MVU 角色卡项目（`form: "charactercard"`, `mvu: true`） |

`--worldbook` 和 `--mvu` 不能同时使用，因为 worldbook 项目不允许启用 MVU。两者都不提供时，新建 state 默认使用 `form: "charactercard"`、`mvu: false`；更新已有 state 时不改变现有的 `form` / `mvu`。

**行为：**

1. 读取 `.cardrc.json`
2. 如果 `tavern-cards-state.json` 不存在：创建初始骨架，包含 .cardrc.json 的默认值
3. 如果已存在：覆盖以下字段：
   - `typeLists` ← `default_type_lists`
   - `strategyThresholds` ← `default_strategy_thresholds`
   - `partOrder` ← `default_part_order`
   - `depth_defaults` ← `depth_defaults`
   - `projectName`：仅在为空时从项目名设置
   - `create_date`：仅在为空时设置为当前时间

### validate-mvu

校验 MVU 项目的 `initvar.yaml` 是否符合 `schema.ts` 定义的变量结构。

```
tavern-cards-forge validate-mvu <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径（跳过项目查找） |
| `--initvar <path>` | 指定要校验的 initvar YAML 文件路径；绝对路径直接使用，相对路径基于当前工作目录解析；未提供时默认校验项目根目录下的 `世界书/变量/initvar.yaml` |

**前置条件：**

- `tavern-cards-state.json` 中 `mvu: true`
- `state.zod` 存在（含 `schemaPath` 指向 `schema.ts`），导出 Zod `Schema`
- 待校验的 initvar YAML 文件已编写（未提供 `--initvar` 时从 `entryManifest` 中 `[InitVar]` 条目的 `path` 字段解析默认路径）

**行为：**

1. 读取 state.json，检查 `mvu === true` 与 `state.zod` 存在（缺失时报错提示运行 `forge unpack` 自动填充）
2. 用 jiti 加载 `state.zod.schemaPath` 指向的 `schema.ts`，注入全局 `z`（Zod v4）与 `_`（lodash）。单文件产物已内置这三者，`schema.ts` **禁止任何 `import` 语句**，预检命中即报错；同时检测同一 `z.object` 内重复字段键
3. 解析指定的 initvar YAML 文件，用 Schema 校验；通过打印成功信息，失败打印详细错误路径与原因

**示例：**

```bash
# 校验默认 initvar
tavern-cards-forge validate-mvu <project>

# 指定 state 路径
tavern-cards-forge validate-mvu <project> --state ./cards/MyCharacter/tavern-cards-state.json

# 校验额外开场白的 initvar_override
tavern-cards-forge validate-mvu <project> --initvar ./cards/MyCharacter/开场白/initvar/1.yaml
```

**输出示例（成功）：**

```
validate-mvu: ./cards/MyCharacter/开场白/initvar/1.yaml 校验通过
```

**输出示例（失败）：**

```
Validation failed:
  path: 世界.当前地点
  message: Invalid input: expected string, received undefined
```

### query

使用 JSONPath 表达式查询 `tavern-cards-state.json`。

```
tavern-cards-forge query <project> <jsonpath> [选项]
```

| 参数 | 说明 |
|------|------|
| `<project>` | 项目名称或 `--state` 模式下的占位符 |
| `<jsonpath>` | JSONPath 表达式 |

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径（跳过项目查找） |
| `--format <format>` | 输出格式：json / yaml（默认 json） |

**行为：**

1. 读取 `tavern-cards-state.json`
2. 对其应用 JSONPath 表达式
3. 结果为数组，输出到 stdout；无匹配时静默退出（exit 0）

**示例：**

```bash
# 项目名 / form 等顶层字段
tavern-cards-forge query <project> '$.projectName'
tavern-cards-forge query <project> '$.form'

# 遍历某分类下条目名称（*~ 获取 key）
tavern-cards-forge query <project> '$.entryManifest.角色.*~'

# 遍历所有条目的策略类型
tavern-cards-forge query <project> '$.entryManifest[*][*].strategy.type'

# 过滤表达式（禁用的条目）
tavern-cards-forge query <project> '$.entryManifest[*][?(@.enabled===false)]'

# YAML 格式输出
tavern-cards-forge query <project> '$.typeLists' --format yaml
```

### patch

对 `tavern-cards-state.json` 应用 RFC 6902 JSON Patch。

```
tavern-cards-forge patch <project> [patch] [选项]
```

| 选项 | 说明 |
|------|------|
| `--file <path>` | 从文件读取 patch（跳过参数/stdin） |
| `--state <path>` | 直接指定 state.json 路径 |
| `--dry-run` | 预览变更，不写入文件 |
| `--no-backup` | 跳过备份创建 |

**输入优先级**：`--file` > `[patch]` 参数 > stdin

**行为：**

1. 加载 state.json 和 patch
2. **预检查**：`add`/`replace` 涉及文件路径字段时验证源文件存在、目标不存在（**不要提前手动重命名**）；检测条目重命名并提醒
3. 备份原 state 到 `.patch-history/{project}/{timestamp}.json`
4. 执行文件 rename（仅当 replace 文件路径字段时）
5. 应用 JSON Patch；验证结果符合 TavernCardsState schema，失败则回滚文件操作与备份
6. 检查配置完整性（同 configure），不通过则输出警告但不中断；写入新 state.json

**文件自动重命名**：`replace` 修改文件路径字段时，patch 自动 rename（源存在 → 目标不存在 → rename → 更新 state）。**不要提前手动重命名**，否则 precheck 会因源文件不存在而失败。涉及字段：

| 路径模式 | 说明 |
|---------|------|
| `/entryManifest/{type}/{name}/path` | 条目内容文件 |
| `/entryManifest/{type}/{name}/contents/{i}/file` | 内容片段文件 |
| `/regex_scripts/{name}/replace_file` | 正则替换文件 |
| `/extensions/tavern_helper/scripts/{name}/script_file` | 脚本文件 |
| `/zod/schemaPath`、`/avatar`、`/first_messages/{i}` | Zod schema / 头像 / 开场白 |

将 `正则/状态栏.txt` 改名为 `正则/状态栏.html`：

```bash
# ✓ 直接 patch，工具自动重命名
tavern-cards-forge patch <project> '[{"op":"replace","path":"/regex_scripts/状态栏/replace_file","value":"正则/状态栏.html"}]'

# ✗ 手动 mv 后再 patch（precheck 会失败）
mv 正则/状态栏.txt 正则/状态栏.html
```

**示例：**

```bash
# 从文件读取
tavern-cards-forge patch <project> --file ./patches/update.json

# 直接传入 JSON Patch 数组
tavern-cards-forge patch <project> '[{"op":"remove","path":"/entryManifest/地理/废弃地点"}]'

# 从 stdin/管道读取、预览、跳过备份
echo '[{"op":"remove","path":"/entryManifest/地理/废弃地点"}]' | tavern-cards-forge patch <project>
tavern-cards-forge patch <project> --file ./patches/update.json --dry-run
tavern-cards-forge patch <project> --file ./patches/update.json --no-backup
```

**Patch 数组示例：**

```json
[
  { "op": "add", "path": "/entryManifest/角色/新角色", "value": { "path": "角色/新角色.yaml", "keywords": ["新角色"] } },
  { "op": "replace", "path": "/entryManifest/角色/主角/path", "value": "角色/新主角.yaml" },
  { "op": "move", "from": "/entryManifest/NPC/村民A", "path": "/entryManifest/NPC/老村民" },
  { "op": "remove", "path": "/entryManifest/地理/废弃地点" }
]
```

**输出示例：**

```
Precheck: OK
Files:
  renamed 角色/主角.yaml → 角色/新主角.yaml
Applied 3 operations → tavern-cards-state.json
Backup: .patch-history/MyCharacter/2026-05-09T143052.json
```

`move` 重命名条目时不会自动修改文件路径，输出提醒：`Warnings: renamed entry "旧名字" → "新名字", file paths unchanged. Consider updating path field for consistency.`

### export

从 forge 项目 state 导出 SillyTavern 可直接导入的三类资源：世界书、正则脚本、助手脚本。与 `pack` 不同，`export` 不产出整卡，而是按资源类型分别产出可独立导入的文件，且不受 `state.form` 限制。

```
tavern-cards-forge export <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--state <path>` | 直接指定 state.json 路径；此时 `<project>` 仅为占位符 |
| `--output <dir>` | 输出目录；默认 `<当前目录>/<projectName>-resources` |
| `--kind <kind>` | 导出哪类资源：`worldbook`、`regex`、`helper` 逗号分隔列表，或 `all`（默认） |

**产出文件：**

| 资源 | 文件 | 格式 |
|------|------|------|
| 世界书 | `<worldbookName>.json` | 扁平格式（ST 可直接导入） |
| 正则 | `regex-scripts/<scriptName>.json` | 单对象（与 ST 自家导出形态一致，可逐文件导入） |
| 助手脚本 | `helper-scripts/<scriptName>.json` | Tavern Helper Script 单对象，每脚本一文件 |

**示例：**

```bash
# 导出全部三类资源
tavern-cards-forge export <project>

# 仅导出世界书（charactercard 项目同样可导出世界书）
tavern-cards-forge export <project> --kind worldbook

# 仅导出正则
tavern-cards-forge export <project> --kind regex

# 仅导出助手脚本
tavern-cards-forge export <project> --kind helper

# 未注册项目时，使用占位符 + --state
tavern-cards-forge export temp --state ./cards/MyCharacter/tavern-cards-state.json --output ./out
```

### split

从已有角色卡（PNG 或 JSON）分离出 SillyTavern 可直接导入的三类资源，无需先建 forge 项目；条目数 / 脚本数与卡内完全一致。

```
tavern-cards-forge split <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--file <path>` | 输入角色卡（PNG 或 JSON）；未注册项目时必需 |
| `--output <dir>` | 输出目录；默认 `<当前目录>/<worldbookName>-split` |
| `--kind <kind>` | 分离哪类资源：`worldbook`、`regex`、`helper` 逗号分隔列表，或 `all`（默认） |

世界书名优先级：嵌入式 `character_book.name` → 卡名 → 文件名。产出文件结构同 `export`。

**输入形态**：`--file` 支持 PNG 角色卡与 JSON 文件。JSON 输入自动识别以下三种：

- 角色 JSON 卡（V2/V3，含 `spec` + `data` 包装层）——与 PNG 卡读取相同的 `data.character_book` / `data.extensions` 路径
- 独立世界书 JSON（扁平格式，`{ entries: {...} }`）——已是可导入形态，原样落盘
- 顶层 `entries` 数组（`character_book` 嵌套格式平铺）——按嵌入式 book 转扁平

PNG 与 JSON 角色卡的内嵌资源结构一致，分离产出**字节级等价**。

**示例：**

```bash
# 从角色卡（PNG 或 JSON）分离全部资源（temp 仅为占位符）
tavern-cards-forge split temp --file ./MyCharacter.png

# 仅分离世界书
tavern-cards-forge split temp --file ./MyCharacter.json --kind worldbook

# 仅分离正则
tavern-cards-forge split temp --file ./MyCharacter.png --kind regex

# 仅分离助手脚本
tavern-cards-forge split temp --file ./MyCharacter.json --kind helper
```

## 典型工作流

### 从零创建角色卡

```bash
# 1. 编写 .cardrc.json（注册项目、定义默认配置）
# 2. 初始化项目
tavern-cards-forge init <project>
# 3. 在 state.json 中设置项目属性（form、mvu 等）
# 4. 编写内容文件，通过 patch 注册条目到 entryManifest
# 5. 推导运行时字段、打包
tavern-cards-forge configure <project> && tavern-cards-forge pack <project>
```

MVU 角色卡在此基础上编写 `schema.ts`、`initvar.yaml`、变量更新规则，并用 `forge validate-mvu <project>` 校验。

### 从现有角色卡导入

```bash
# 1. 在 .cardrc.json 注册项目（artifact 指向 PNG/JSON）
# 2. 解包并初始化默认配置
tavern-cards-forge unpack <project> && tavern-cards-forge init <project>
# 3. 编辑 state.json 与内容文件、推导运行时字段、打包
tavern-cards-forge configure <project> && tavern-cards-forge pack <project>
```

PNG/JSON 输出由 `avatar` 字段控制：保留路径 → PNG，清空 → JSON。

独立世界书导入导出同理：`unpack temp --file ./worldbook.json` 解包（`form` 自动置 `worldbook`），编辑后 `pack` 重出扁平格式独立世界书 JSON（即 ST 可导入格式，详见 [DataReference](DataReference.md#export--split-产出格式)）。

### 无项目配置的临时操作

temp 仅为占位符，直接指定输入/输出路径即可运行：

```bash
tavern-cards-forge pack     temp --state ./some-state.json --output ./output.png
tavern-cards-forge unpack   temp --file ./input.png --state ./existing-state.json   # merge
tavern-cards-forge unpack   temp --file ./input.png --output ./output-dir --fresh  # 全新解包
tavern-cards-forge export   temp --state ./some-state.json --output ./out          # 从 state 导出可导入资源
tavern-cards-forge split    temp --file ./card.png --output ./out                   # 从卡分离可导入资源
```
