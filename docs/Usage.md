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
- [典型工作流](#典型工作流)

## 安装与构建

### 直接运行单文件产物

发布包中的 `dist/index.mjs` 已打包运行时依赖，用户无需在下载目录执行 `npm install`；只要本机有 Node.js 20+ 即可运行。

```bash
node dist/index.mjs --help
```

如需直接执行文件本身，确保它有可执行权限：

```bash
chmod +x dist/index.mjs
./dist/index.mjs --help
```

### 从源码构建

开发或重新构建时仍需安装依赖：

```bash
npm install
npm run build          # tsup → dist/index.mjs（单文件 bundled CLI）
node dist/index.mjs --help
```

也可在源码目录全局链接：

```bash
npm link
tavern-cards-forge --help
```

## 命令

所有命令的第一个参数 `<project>` 通常填写 `.cardrc.json` 中 `projects` 的 key。若不想注册项目，也可以使用占位符，并通过路径选项直接指定输入/输出：

- **只需要 state 路径的命令**：configure、init、validate-mvu、query、patch — 提供 `--state` 后，`<project>` 可写成任意占位符。
- **需要同时指定输入和输出的命令**：pack、unpack — pack 需要 `--state` + `--output`，unpack 需要 `--file` + `--output`；此时 `<project>` 也只作为占位符。

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
2. **验证所有文件路径字段**：检查以下字段引用的文件是否存在
   - `entryManifest.{type}.{name}.path` / `.contents[].file`
   - `regex_scripts.{name}.replace_file`
   - `extensions.tavern_helper.scripts.{name}.script_file`
   - `avatar`
   - `first_messages[]`

   若有缺失文件，列出清单并退出
3. 解析所有条目，加载 `path` 或 `contents` 引用的内容文件；同时加载 `replace_file` / `script_file` 引用的文件内容
4. 将 EntryManifestLeaf 转换为 SillyTavern 原始格式
5. 根据 `form` 字段和 `avatar` 字段选择输出格式：
   - `form=worldbook` → 输出 JSON（扁平格式独立世界书）
   - `form=charactercard` 且 `avatar` 非空 → 输出 PNG（嵌入角色卡元数据 + 标准格式世界书）
   - `form=charactercard` 且 `avatar` 为空 → 输出 JSON（标准格式角色卡）
6. 输出路径优先级：`--output` > 项目 `artifact` > state 同目录下 `{name}.json` / `{name}.png`

**示例：**

```bash
# 通过注册项目打包
tavern-cards-forge pack <project>

# 覆盖输出路径
tavern-cards-forge pack <project> --output /tmp/test.png

# 未注册项目时，使用占位符并同时提供输入和输出
tavern-cards-forge pack temp \
  --state ./cards/MyChar/tavern-cards-state.json \
  --output ./dist/MyChar.png

# 仅提供 --state 而没有 --output 会失败
tavern-cards-forge pack temp --state ./cards/MyChar/tavern-cards-state.json
```

### unpack

将 SillyTavern PNG/JSON 还原为 `tavern-cards-state.json` + 内容文件。

```
tavern-cards-forge unpack <project> [选项]
```

| 选项 | 说明 |
|------|------|
| `--file <path>` | 直接指定输入 PNG/JSON 路径；与 `--output` 配合可跳过项目查找 |
| `--output <dir>` | 覆盖输出目录；未注册项目时与 `--file` 配合必需 |
| `--raw` | 输出原始 SillyTavern JSON（不转换） |
| `--split` | 拆分长内容为独立文件 |

**行为：**

1. 读取 `artifact` 指向的 PNG/JSON 文件
2. 自动识别格式类型：
   - PNG 文件 → 角色卡格式
   - JSON 文件 → 检测扁平格式或 SillyTavern 标准格式
3. 提取所有条目，转换为扁平的 EntryManifestLeaf 结构
4. **MVU 自动检测**：满足条件时自动设置 `mvu: true`（详见 [机制原理](Mechanisms.md#mvu-自动检测)）
5. 每个条目的 content 处理：
   - 剩余内容若解析为 YAML 对象，保存为 `世界书/{name}.yaml`，否则保存为 `世界书/{name}.txt`
6. `regex_scripts` 中每个脚本的 `replaceString` 写入 `正则/{name}.txt`（如果非空），并设置 `replace_file` 字段
7. `tavern_helper.scripts` 中每个脚本的 `content` 写入 `脚本/{name}.txt`（如果非空），并设置 `script_file` 字段
8. `first_messages` 写入 `开场白/0.txt`, `1.txt`, ...（[0] 为 first_mes，[1:] 为 alternate_greetings）
9. 生成 `tavern-cards-state.json`，根据输入文件类型设置 `form` 字段
10. 输出目录优先级：`--output` > `state_file` 所在目录 > 当前目录下以文件名命名的目录

**示例：**

```bash
# 通过注册项目解包
tavern-cards-forge unpack <project>

# 未注册项目时，使用占位符并同时提供输入和输出
tavern-cards-forge unpack temp \
  --file ./MyCharacter.png \
  --output ./MyCharacter-project

# 仅提供 --file 而没有 --output 会失败
tavern-cards-forge unpack temp --file ./MyCharacter.png

# 输出原始 JSON
tavern-cards-forge unpack <project> --raw
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
- **`--force` 模式**：覆盖所有推导字段（strategy、position、uid）

推导的具体算法（验证规则、策略推导、位置推导、排序分配、UID 分配）详见 [机制原理](Mechanisms.md#configure-推导算法)。

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

**前置条件：**

- `tavern-cards-state.json` 中 `mvu: true`
- 项目根目录存在 `schema.ts`，导出 Zod `Schema`
- `世界书/变量/initvar.yaml` 已编写

**行为：**

1. 读取 state.json，检查 `mvu === true`
2. 用 jiti 加载 `schema.ts`，注入全局 `z`（Zod v4）和 `_`（lodash）
   - 单文件产物已内置 jiti、Zod 和 lodash；项目自己的 `schema.ts` 应使用全局 `z` / `_`，不要依赖本地 `node_modules` 中的 `import { z } from 'zod'`
3. 解析 `世界书/变量/initvar.yaml`
4. 用 Schema 校验 YAML 数据
5. 校验通过打印成功信息，失败打印详细错误路径和原因

**示例：**

```bash
tavern-cards-forge validate-mvu <project>
tavern-cards-forge validate-mvu <project> --state ./cards/MyChar/tavern-cards-state.json
```

**输出示例（成功）：**

```
validate-mvu: initvar.yaml 校验通过
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
# 顶层字段
tavern-cards-forge query <project> '$.projectName'
tavern-cards-forge query <project> '$.form'

# 条目名称列表（*~ 获取 key）
tavern-cards-forge query <project> '$.entryManifest.character.*~'

# 所有条目的 uid
tavern-cards-forge query <project> '$.entryManifest[*][*].uid'

# 嵌套字段
tavern-cards-forge query <project> '$.entryManifest[*][*].strategy.type'
tavern-cards-forge query <project> '$.entryManifest[*][*].position.order'

# 过滤表达式
tavern-cards-forge query <project> '$.entryManifest[*][?(@.strategy.type==="constant")]'
tavern-cards-forge query <project> '$.entryManifest[*][?(@.enabled===false)]'

# 扩展字段
tavern-cards-forge query <project> '$.extensions.talkativeness'

# YAML 格式输出
tavern-cards-forge query <project> '$.typeLists' --format yaml

# 使用 --state 跳过项目查找
tavern-cards-forge query temp '$.projectName' --state ./cards/MyChar/tavern-cards-state.json
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

1. 加载 state.json 和 patch（文件/参数/stdin）
2. **预检查**：
    - `add` 操作：涉及文件路径字段时验证文件存在
    - `replace` 操作：验证源文件存在、目标文件不存在（**注意**：不要提前手动重命名文件）
    - 检测条目重命名并发出提醒
3. 备份原 state.json 到 `.patch-history/{project}/{timestamp}.json`
4. 执行文件 rename（仅当 replace 文件路径字段时）
5. 应用 JSON Patch
6. 验证结果符合 TavernCardsState schema
   - 失败 → 回滚文件操作，恢复备份
7. **验证提醒**：检查配置完整性（同 configure），不通过则输出警告但不中断
8. 写入新 state.json

**文件自动重命名：**

当 `replace` 操作修改文件路径字段时，patch 会自动执行文件重命名：

- **不要提前手动重命名文件**，否则 precheck 会因源文件不存在而失败
- patch 会验证：源文件存在 → 目标文件不存在 → 执行 rename → 更新 state

**示例**：将 `正则/状态栏.txt` 改名为 `正则/状态栏.html`

```bash
# 正确做法：直接 patch，工具自动重命名文件
tavern-cards-forge patch <project> '[{"op":"replace","path":"/regex_scripts/状态栏/replace_file","value":"正则/状态栏.html"}]'
```

```bash
# 错误做法：手动 mv 后再 patch（precheck 会失败，因为源文件已不存在）
mv 正则/状态栏.txt 正则/状态栏.html
```

**涉及的文件路径字段：**

| 路径模式 | 说明 |
|---------|------|
| `/entryManifest/{type}/{name}/path` | 条目内容文件 |
| `/entryManifest/{type}/{name}/contents/{i}/file` | 内容片段文件 |
| `/regex_scripts/{name}/replace_file` | 正则替换文件 |
| `/extensions/tavern_helper/scripts/{name}/script_file` | 脚本文件 |
| `/avatar` | 头像 PNG |
| `/first_messages/{i}` | 开场白文件 |

**示例：**

```bash
# 从文件读取
tavern-cards-forge patch <project> --file ./patches/update.json

# 直接传入 JSON Patch 数组
tavern-cards-forge patch <project> '[{"op":"remove","path":"/entryManifest/地理/废弃地点"}]'

# 从 stdin/管道读取
echo '[{"op":"remove","path":"/entryManifest/地理/废弃地点"}]' | tavern-cards-forge patch <project>

# 预览变更
tavern-cards-forge patch <project> --file ./patches/update.json --dry-run

# 跳过备份
tavern-cards-forge patch <project> --file ./patches/update.json --no-backup
```

**Patch 数组示例：**

```json
[
  { "op": "add", "path": "/entryManifest/角色/新角色", "value": { "path": "contents/新角色.yaml", "keywords": ["新角色"] } },
  { "op": "replace", "path": "/entryManifest/角色/主角/path", "value": "contents/新主角.yaml" },
  { "op": "move", "from": "/entryManifest/NPC/村民A", "path": "/entryManifest/NPC/老村民" },
  { "op": "remove", "path": "/entryManifest/地理/废弃地点" }
]
```

**输出示例：**

```
Precheck: OK
Files:
  renamed contents/主角.yaml → contents/新主角.yaml
Applied 3 operations → tavern-cards-state.json
Backup: .patch-history/MyCharacter/2026-05-09T143052.json
```

**条目重命名提醒：**

当 `move` 操作重命名条目时，工具不会自动修改文件路径，而是输出提醒：

```
Warnings:
  - renamed entry "旧名字" → "新名字", file paths unchanged. Consider updating path field for consistency.
```

## 典型工作流

### 从零创建角色卡

```bash
# 1. 编写 .cardrc.json（注册项目、定义默认配置）
# 2. 初始化项目（创建 state.json，写入 .cardrc.json 默认值）
tavern-cards-forge init <project>

# 3. 在 state.json 中设置项目属性（form、mvu 等）
# 4. 编写内容文件，通过 patch 注册条目到 entryManifest
# 5. 推导运行时字段
tavern-cards-forge configure <project>

# 6. 打包
tavern-cards-forge pack <project>
```

### MVU 角色卡

在从零创建角色卡的基础上，编写 MVU 变量时增加以下步骤：

```bash
# 编写 schema.ts、世界书/变量/initvar.yaml、世界书/变量/变量更新规则.yaml
# 复制模板文件、应用 JSON Patch 合并配置（由 skill 指导完成）
# 校验 initvar.yaml
tavern-cards-forge validate-mvu <project>
```

### 从现有角色卡导入

```bash
# 1. 在 .cardrc.json 注册项目，设置 artifact 指向 PNG/JSON
# 2. 解包
tavern-cards-forge unpack <project>

# 3. 初始化默认配置
tavern-cards-forge init <project>

# 4. 编辑 state.json（整理条目类型、移除 unknown）和内容文件
# 5. 推导运行时字段
tavern-cards-forge configure <project>

# 6. 打包
tavern-cards-forge pack <project>
```

**输出格式控制**：

- 保留 `avatar` 字段（如 `"avatar": "avatar.png"`）→ 输出 PNG 格式
- 清空 `avatar` 字段（如 `"avatar": ""`）→ 输出 JSON 格式

### 无项目配置的快速操作

```bash
# 直接指定文件路径，temp 仅为占位符
tavern-cards-forge pack temp --state ./some-state.json --output ./output.png
tavern-cards-forge unpack temp --file ./input.png --output ./output-dir
```

### 独立世界书导入导出

```bash
# 1. 解包独立世界书 JSON
tavern-cards-forge unpack temp --file ./worldbook.json --output ./worldbook-project

# 2. 编辑 tavern-cards-state.json 和世界书内容文件

# 3. 重新打包为独立世界书 JSON
tavern-cards-forge pack temp --state ./worldbook-project/tavern-cards-state.json --output ./worldbook-new.json
```

**注意事项**：

- 独立世界书解包后，`form` 字段会自动设置为 `"worldbook"`
- 打包时会自动使用扁平格式输出 JSON 文件
- 支持在扁平格式和 SillyTavern 标准格式之间无损转换
