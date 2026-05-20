# 数据说明

## 目录

- [配置文件](#配置文件)
  - [.cardrc.json](#cardrcjson)
  - [tavern-cards-state.json](#tavern-cards-statejson)
- [数据模型](#数据模型)
- [格式转换映射](#格式转换映射)
- [项目目录结构示例](#项目目录结构示例)

## 配置文件

### `.cardrc.json`

项目根目录下的共享配置文件，定义所有项目的默认规则。工具会从当前工作目录向上查找 `.cardrc.json`。

```jsonc
{
  // 项目注册表：key 即项目名，用于所有命令的 <project> 参数
  "projects": {
    "MyCharacter": {
      "state_file": "cards/MyCharacter/tavern-cards-state.json",
      "artifact": "cards/MyCharacter/MyCharacter.png"
    },
    "MyWorldbook": {
      "state_file": "cards/MyWorldbook/tavern-cards-state.json",
      "artifact": "cards/MyWorldbook/MyWorldbook.json"
    }
  },

  // 各位置的条目类型默认顺序
  "default_type_lists": {
    "before_char": ["EJS预处理", "世界观", "扮演准则", "时间线", "地理"],
    "after_char": ["角色", "NPC"],
    "depth": ["事件", "MVU"]
  },

  // 默认策略阈值
  // "Infinity" = 始终蓝灯 (constant), 0 = 始终绿灯, >0 = 有条件绿灯, null = disabled
  // 嵌套类型按 part 分别配置
  "default_strategy_thresholds": {
    "角色": {
      "catalog": "Infinity",
      "basic": { "threshold": 5, "required": true },
      "personality": { "threshold": 2, "required": true }
    },
    "NPC": 0,
    "EJS预处理": "Infinity"
  },

  // 各类型的 part 排序规则
  "default_part_order": {
    "角色": ["catalog", "basic", "personality", "tri_faceted", "other"],
    "MVU": ["variable_list", "update_rules", "output_format", "initvar"]
  },

  // at_depth 位置的默认 role 和 depth
  "depth_defaults": {
    "role": "system",
    "depth": 0
  }
}
```

#### ProjectConfig 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `state_file` | string | 是 | `tavern-cards-state.json` 的路径，相对于 `.cardrc.json` 所在目录 |
| `artifact` | string | 否 | 打包产物路径 (pack 输出 / unpack 输入)，相对于 `.cardrc.json` 所在目录 |

### `tavern-cards-state.json`

每个项目的数据源文件，位于项目目录中。

```jsonc
{
  "projectName": "MyCharacter",
  "worldbookName": "MyCharacter",
  "form": "charactercard",          // "charactercard" | "worldbook"
  "mvu": false,                     // worldbook 时必须为 false (Zod 校验)；unpack 时自动检测
  "typeLists": {
    "before_char": ["EJS预处理", "世界观"],
    "after_char": ["角色", "NPC"],
    "depth": ["事件", "MVU"]
  },
  "strategyThresholds": {           // 可选，覆盖 .cardrc.json 默认值
    "自定义类型": "Infinity"
  },
  "partOrder": {                    // 可选，覆盖 .cardrc.json 默认值
    "自定义类型": ["part_a", "part_b"]
  },
  "depth_defaults": {               // at_depth 位置的默认 role/depth
    "role": "system",
    "depth": 0
  },

  // 角色卡元数据 (form=charactercard 时)
  "avatar": "avatar.png",
  "description": "角色描述",
  "first_messages": ["开场白/0.txt", "开场白/1.txt"],
  "creator": "Author",
  "creator_notes": "",
  "version": "1.0",
  "create_date": "",

  // 条目清单：双层 Record，外层 key=类型，内层 key=条目名
  "entryManifest": {
    "角色": {
      "Alice基本": {
        "path": "contents/Alice基本.txt",
        "scope": "specific",
        "part": "basic",
        "keywords": ["Alice"],
        "enabled": true,
        "uid": 0
      }
    }
  }
}
```

## 数据模型

### EntryManifest（双层 Record）

条目清单采用双层 Record 结构，外层 key 为类型名称，内层 key 为条目名称。

```typescript
{
  [类型名称]: {           // 如 "角色", "地理", "unknown"
    [条目名称]: EntryManifestLeaf
  }
}
```

**重要**：条目名称是 `EntryManifestLeaf` 的 key（来自 SillyTavern 的 `comment` 字段），`EntryManifestLeaf` 本身不包含 `name` 字段。

### EntryManifestLeaf

每个条目的完整定义，包含规划字段和运行时字段。

| 字段 | 类型 | 分类 | 说明 |
|------|------|------|------|
| `path` | string? | 规划 | 内容文件路径（与 `contents` 互斥） |
| `contents` | Array? | 规划 | 有序内容片段列表（与 `path` 互斥），每个片段的 `content` 和 `file` 也互斥 |
| `scope` | "catalog" \| "specific"? | 规划 | 速览/详情；catalog 固定蓝灯 |
| `part` | string? | 规划 | 同类型内的子分类标识 |
| `rephrase` | boolean? | 规划 | 是否为重述/澄清条目 |
| `keywords` | string[] | 规划 | 绿灯关键词候选 |
| `uid` | number? | 运行时 | 条目唯一标识符（由 configure 推导） |
| `enabled` | boolean? | 运行时 | 是否启用（由 configure 推导） |
| `strategy` | object? | 运行时 | 激活策略（由 configure 推导） |
| `position` | object? | 运行时 | 插入位置（由 configure 推导） |
| `display_index` | number? | 运行时 | SillyTavern 界面显示顺序 |
| `probability` | number? | 运行时 | 激活概率 (0-100) |
| `recursion` | object? | 运行时 | 递归设置（空对象时省略） |
| `effect` | object? | 运行时 | 效果（黏性/冷却/延迟，空对象时省略） |
| `group` | object? | 运行时 | 组设置 |
| `extra` | object? | 运行时 | 额外字段 |

> **注意**：运行时字段由 `configure` 命令自动推导，编写 state.json 时通常只需填写规划字段。运行时字段仅在需要覆盖默认推导结果时手动设置。

### recursion 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `prevent_incoming` | boolean? | 禁止其他条目递归激活本条目 |
| `prevent_outgoing` | boolean? | 禁止本条目递归激活其他条目 |
| `delay_until` | number? | 延迟到第 n 级递归检查时才能激活 |

### effect 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `sticky` | number? | 黏性：激活后持续 n 条消息 |
| `cooldown` | number? | 冷却：激活后 n 条消息内不能再次激活 |
| `delay` | number? | 延迟：聊天至少有 n 楼消息时才能激活 |

### group 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `labels` | string[] | 组标签列表 |
| `use_priority` | boolean | 是否使用优先级（默认 false） |
| `weight` | number | 权重（默认 100） |
| `use_scoring` | boolean \| null | 是否使用评分（默认 null） |

### strategy 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | "constant" \| "selective" \| "vectorized" | 策略类型 |
| `keys` | string[]? | 主关键字 |
| `keys_secondary` | object? | 次要关键字（含 `logic` 和 `keys`） |
| `scan_depth` | number \| "same_as_global"? | 扫描深度 |

### position 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | PositionType (见下) | 位置类型 |
| `role` | "system" \| "user" \| "assistant"? | 角色 |
| `depth` | number? | 插入深度（仅 at_depth 时有效，缺省取 `depth_defaults.depth`） |
| `order` | number | 插入顺序 |

### PositionType 枚举

| 值 | SillyTavern extensions.position |
|----|------|
| `before_character_definition` | 0 |
| `after_character_definition` | 1 |
| `before_author_note` | 2 |
| `after_author_note` | 3 |
| `at_depth` | 4 |
| `before_example_messages` | 5 |
| `after_example_messages` | 6 |

### SelectiveLogic 枚举

| 值 | SillyTavern selectiveLogic |
|----|------|
| `and_any` | 0 |
| `not_all` | 1 |
| `not_any` | 2 |
| `and_all` | 3 |

### RegexScript 对象

正则脚本定义，用于文本替换。以 `Record<string, RegexScript>` 形式存储在 `regex_scripts` 中，key 即脚本名称，`RegexScript` 本身不包含 `name` 字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 脚本唯一标识符 |
| `findRegex` | string | 匹配的正则表达式 |
| `replaceString` | string? | 内联替换内容（与 `replace_file` 互斥） |
| `replace_file` | string? | 替换内容文件路径（与 `replaceString` 互斥） |
| `trimStrings` | string[]? | 需要修剪的字符串列表 |
| `placement` | number[]? | 应用位置 |
| `disabled` | boolean? | 是否禁用 |
| `markdownOnly` | boolean? | 仅在 Markdown 中应用 |
| `promptOnly` | boolean? | 仅在提示词中应用 |
| `runOnEdit` | boolean? | 编辑时运行 |
| `substituteRegex` | number? | 正则替换模式 |
| `minDepth` | number \| null? | 最小深度 |
| `maxDepth` | number \| null? | 最大深度 |

### TavernHelperScript 对象

TavernHelper 脚本定义，用于扩展功能。以 `Record<string, TavernHelperScript>` 形式存储在 `extensions.tavern_helper.scripts` 中，key 即脚本名称，`TavernHelperScript` 本身不包含 `name` 字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | "script" | 脚本类型 |
| `content` | string? | 内联脚本内容（与 `script_file` 互斥） |
| `script_file` | string? | 脚本文件路径（与 `content` 互斥） |
| `enabled` | boolean | 是否启用 |
| `id` | string | 脚本唯一标识符 |
| `info` | string? | 脚本说明 |
| `button` | object? | 按钮配置 |
| `data` | object? | 额外数据 |

### TavernHelper 对象

TavernHelper 扩展配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `scripts` | Record\<string, TavernHelperScript\>? | 脚本列表（key 为脚本名称） |
| `variables` | object? | 变量定义 |

### Schema 验证

以下互斥字段和跨字段约束会在 Schema 层面验证：

| Schema | 互斥字段/约束 | 验证规则 |
|--------|---------|---------|
| `EntryManifestLeaf` | `path` ↔ `contents` | 二选一，不能同时存在或都为空 |
| `contents[]` | `content` ↔ `file` | 二选一，不能同时存在或都为空 |
| `RegexScript` | `replaceString` ↔ `replace_file` | 二选一，不能同时存在或都为空 |
| `TavernHelperScript` | `content` ↔ `script_file` | 二选一，不能同时存在或都为空 |
| `TavernCardsState` | `form` + `mvu` | `form=worldbook` 时 `mvu` 必须为 `false` |

**验证失败示例：**

```json
{
  "path": "contents/foo.txt",
  "contents": [{ "content": "bar" }]
}
```

错误信息：
```
[
  {
    "code": "custom",
    "path": ["path"],
    "message": "不能同时填写 `path` 和 `contents`"
  },
  {
    "code": "custom",
    "path": ["contents"],
    "message": "不能同时填写 `path` 和 `contents`"
  }
]
```

## 格式转换映射

### 支持的格式

工具支持两种格式的自动识别和转换：

| 格式类型 | 文件类型 | 用途 | 条目格式 |
|---------|---------|------|---------|
| 角色卡（PNG） | PNG | 包含头像和世界书的角色定义 | SillyTavern 标准格式 |
| 角色卡（JSON） | JSON | 无头像的角色定义 | SillyTavern 标准格式 |
| 独立世界书 | JSON | 独立的世界书文件 | 扁平格式 |

**输出格式选择规则**：

- `form = "worldbook"` → 独立世界书 JSON（扁平格式）
- `form = "charactercard"` 且 `avatar` 非空 → 角色 PNG 卡（标准格式）
- `form = "charactercard"` 且 `avatar` 为空 → 角色 JSON 卡（标准格式）

**格式差异说明**：

- **角色卡（PNG/JSON）**：使用 SillyTavern 标准格式，条目字段嵌套在 `extensions` 对象中，包含角色元数据（description、first_messages 等）
- **独立世界书**：使用扁平格式，字段名更简洁（如 `order` 而非 `insertion_order`），无角色元数据

### 角色卡版本

工具支持 SillyTavern 角色卡 V2 和 V3 格式：

| 版本 | spec 值 | 说明 |
|------|---------|------|
| V2 | `chara_card_v2` | 基础格式，`data` 嵌套结构 |
| V3 | `chara_card_v3` | V2 扩展，新增 `assets`、`nickname`、`source` 等字段 |

**输入**：自动识别 V2/V3 格式

**输出**：始终输出 V3 格式（同时填充 V1 兼容字段，确保旧工具可用）

### 世界书格式对比

| 项目 | SillyTavern 标准格式（角色卡内） | 扁平格式（独立世界书） |
|------|------------------------------|---------------------|
| 条目顺序 | `insertion_order` | `order` |
| 位置 | `extensions.position` | `position` |
| 显示索引 | `extensions.display_index` | `displayIndex` |
| 启用状态 | `enabled` (true=启用) | `disable` (true=禁用，语义相反) |
| 关键字 | `keys` | `key` |
| 次要关键字 | `secondary_keys` | `keysecondary` |
| 向量化 | `extensions.vectorized` | `vectorized` |
| 选择逻辑 | `extensions.selectiveLogic` | `selectiveLogic` |
| 深度 | `extensions.depth` | `depth` |
| 角色 | `extensions.role` | `role` |
| 组 | `extensions.group` | `group` |
| 组优先级 | `extensions.group_override` | `groupOverride` |
| 组权重 | `extensions.group_weight` | `groupWeight` |
| 组评分 | `extensions.use_group_scoring` | `useGroupScoring` |
| 扫描深度 | `extensions.scan_depth` | `scanDepth` |
| 排除递归 | `extensions.exclude_recursion` | `excludeRecursion` |
| 阻止递归 | `extensions.prevent_recursion` | `preventRecursion` |
| 延迟递归 | `extensions.delay_until_recursion` | `delayUntilRecursion` |
| 黏性 | `extensions.sticky` | `sticky` |
| 冷却 | `extensions.cooldown` | `cooldown` |
| 延迟 | `extensions.delay` | `delay` |
| 匹配字段 | `extensions.match_*` | `match*` (驼峰命名) |

### 自动识别机制

**unpack** 时根据以下规则自动识别格式：

1. PNG 文件 → 角色卡格式，`form = "charactercard"`
2. JSON 文件：
   - 检测文件结构：
     - 有 `spec` 字段（如 `"spec": "chara_card_v3"`）→ 角色卡 JSON，`form = "charactercard"`
     - 有 `entries` 对象且第一个条目包含 `order` 字段 → 扁平格式世界书，`form = "worldbook"`
     - 有 `entries` 数组 → SillyTavern 标准格式世界书，`form = "worldbook"`

**pack** 时根据 `form` 和 `avatar` 字段选择输出格式：

- `form = "charactercard"` 且 `avatar` 非空 → PNG（SillyTavern 标准格式）
- `form = "charactercard"` 且 `avatar` 为空 → JSON（SillyTavern 标准格式）
- `form = "worldbook"` → JSON（扁平格式）

## 项目目录结构示例

### 角色卡项目

```
project-root/
  .cardrc.json
  cards/
    MyCharacter/
      tavern-cards-state.json
      avatar.png
      世界书/
        Alice基本.txt
        Alice性格.txt
        世界观.txt
      正则/
        格式化.txt
      脚本/
        MVU.txt
      开场白/
        0.txt
        1.txt
```

### MVU 角色卡项目

```
project-root/
  .cardrc.json
  cards/
    MyCharacter/
      tavern-cards-state.json
      schema.ts
      avatar.png
      世界书/
        变量/
          initvar.yaml
          变量列表.txt
          变量更新规则.yaml
          变量输出格式.txt
        Alice基本.txt
        世界观.txt
      正则/
        变量更新美化.html
        变量更新中美化.html
        状态栏界面-实时修改.html
      脚本/
        MVU.txt
        Zod.txt
      开场白/
        0.txt
```

### 独立世界书项目

```
project-root/
  .cardrc.json
  cards/
    MyWorldbook/
      tavern-cards-state.json
      MyWorldbook.json          # 打包产物（扁平格式）
      世界书/
        区域概述.txt
        中央神州.txt
```

### tavern-cards-state.json 差异

**角色卡项目 - PNG 格式** (`form = "charactercard"`, `avatar` 非空):

```json
{
  "projectName": "MyCharacter",
  "worldbookName": "MyCharacter",
  "form": "charactercard",
  "avatar": "avatar.png",
  "first_messages": ["开场白/0.txt"],
  "extensions": {
    "tavern_helper": {
      "scripts": {
        "MVU": { "type": "script", "script_file": "脚本/MVU.txt", "enabled": true, "id": "..." }
      }
    }
  },
  "regex_scripts": {
    "格式化": { "id": "...", "findRegex": "...", "replace_file": "正则/格式化.txt" }
  }
}
```

**角色卡项目 - JSON 格式** (`form = "charactercard"`, `avatar` 为空): (`form = "charactercard"`, `avatar` 为空):

```json
{
  "projectName": "MyCharacter",
  "worldbookName": "MyCharacter",
  "form": "charactercard",
  "avatar": "",
  "first_messages": ["开场白/0.txt"],
  "extensions": {
    "tavern_helper": {
      "scripts": {
        "MVU": { "type": "script", "script_file": "脚本/MVU.txt", "enabled": true, "id": "..." }
      }
    }
  },
  "regex_scripts": {
    "格式化": { "id": "...", "findRegex": "...", "replace_file": "正则/格式化.txt" }
  }
}
```

**独立世界书项目** (`form = "worldbook"`):

```json
{
  "projectName": "MyWorldbook",
  "worldbookName": "MyWorldbook",
  "form": "worldbook",
  "avatar": null,
  "first_messages": [],
  "extensions": null,
  "regex_scripts": null
}
```
