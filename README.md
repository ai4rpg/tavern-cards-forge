# tavern-cards-forge

tavern-cards-forge 是一个离线 CLI 工具，用于在 SillyTavern 角色卡 (PNG) / 世界书 (JSON) 与可编辑的项目目录之间互相转换。

主要目的是作为 skill 的配合脚本: 把角色卡和世界书拆成稳定、可读的文件结构，让 AI 可以更可靠地批量创建、整理、校验和重打包卡片内容，并提供标准的JSON Patch和JSON Path 编辑、查询状态文件。

## 特点

- 离线处理: 不依赖 SillyTavern 服务、网络接口或运行中的前端环境。
- 单一数据源: 项目目录中的状态文件 `tavern-cards-state.json` 记录卡片结构、条目元数据和打包配置。
- 文件化编辑: 世界书条目、正则脚本、TavernHelper 脚本、开场白等内容可拆分为普通文本文件，便于人工编辑和 AI 修改。
- 可自动推导: `configure` 可根据配置补齐 strategy、position、order、uid 等运行时字段。
- 适合 JSON Patch 工作流: `patch` 支持预检查、备份和文件路径自动重命名，方便 skill 生成结构化变更。
- 支持导入导出: 可从现有 PNG/JSON 解包，也可重新打包为角色 PNG、角色 JSON 或独立世界书 JSON。

## 文档索引

- [使用指导](docs/Usage.md) — 安装构建、命令参考、典型工作流
- [数据说明](docs/DataReference.md) — 配置文件字段、数据模型、格式转换映射、目录结构
- [机制原理](docs/Mechanisms.md) — configure 推导算法、patch 机制、格式检测

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
