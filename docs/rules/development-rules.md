# 开发协作规则

## 1. 适用范围与事实来源

本规则适用于 Lucene Lens 仓库内的源码、构建配置、资源和文档。根目录 `AGENTS.md` 只负责索引，本文件是具体协作规则的唯一维护位置。

发生冲突时按以下顺序判断当前事实：

1. 可运行的源码、`package.json`、Maven POM 和构建脚本。
2. `docs/design/plugin-design.md` 中的当前设计。
3. `docs/design/implementation-plan.md` 中的历史首版计划。

计划中的能力不得写成已经实现。实现变化后，应在同一变更中更新相关文档。

## 2. 基本原则

1. 优先交付可验证的小步变更，避免混入无关重构。
2. 读取 Lucene 索引必须保持只读，禁止修改、合并、修复、删除索引文件或获取写锁。
3. 使用 Lucene 官方公开 API 解析索引，不自行实现 Lucene 二进制格式。
4. Extension Host 不执行 Lucene 读取；每次索引操作启动一个 Java CLI 子进程，命令结束后立即退出。
5. Java CLI 不提供 daemon、server、会话注册或其他后台常驻模式。
6. 高基数读取必须分页或设置硬上限，不能一次性把整个索引载入内存。
7. 默认不新增或修改测试用例，除非用户明确要求；仍需执行与变更相称的类型检查、构建或手工验证。

## 3. 当前目录与职责

```text
src/
  extension.ts          扩展激活、命令注册与顶层编排
  platform/             Java 进程和平台适配
  protocol/             TypeScript 协议类型与边界校验
  services/             索引目录与工作区配置服务
  views/                侧边栏索引视图
  webview/              面板状态、消息处理和页面脚本
cli/
  cli-core/             Picocli 入口、SPI、插件加载和公共模型
  cli-plugin-lucene-9/  Lucene 9 SPI 实现与版本相关读取逻辑
dist/                   构建生成的扩展和 CLI 产物
media/                  图标等静态资源
scripts/                构建辅助脚本
docs/                   设计与协作文档
```

职责边界：

- Webview 只发送经过校验的操作意图，不访问文件系统、不启动进程、不接收插件 jar 路径。
- `extension.ts` 负责命令注册和对象装配；可复用业务状态放在 `services`、`views` 或 `webview` 对应模块。
- `JavaCommandRunner` 是 TypeScript 侧唯一的 Java 进程入口。
- TypeScript 与 Java 只通过 stdout 中的 JSON 协议通信；Lucene 对象不得跨越协议边界。
- `cli-core` 不依赖 Lucene，只负责参数、公共校验、SPI 加载、响应封装和退出码。
- 当前 `CliCommand` 直接调用 `LucenePlugin`；在真正出现可复用业务编排前，不为形式上的分层新增空 `command`、`service` 包。
- `cli-core/model` 当前只存放确有复用价值的公共模型；SPI 的结果使用 JSON 可序列化的 Java 基础类型。
- 版本插件的 `adapter` 实现 SPI，可以读取轻量版本元数据；索引打开、查询、Analyzer 实例化等 Lucene 操作必须集中在版本化 `util` 中。
- 每个版本插件只依赖一个 Lucene 主版本，并通过 `META-INF/services` 声明唯一 SPI 实现。
- 插件 jar 不得重复打包 core SPI 或 core model 类。

## 4. 当前版本边界

- 当前产品固定支持 Lucene 9，依赖版本为 9.12.3，运行时要求 Java 11 或更高版本。
- `JavaCommandRunner` 当前固定选择 `dist/cli/plugins/lucene-9/lucene-plugin.jar`；页面中的 Lucene 9 控件只是不可编辑的版本标识。
- 当前不存在插件目录扫描、动态版本解析、兼容插件候选列表或手动版本切换。
- 新增 Lucene 主版本时，必须先更新设计，明确插件发现、探测顺序、选择策略、页面交互和协议变化，再实现代码。
- CLI core 每次运行只加载 `--plugin` 显式指定的一个插件，不扫描或同时加载多个插件。

## 5. TypeScript 规则

- 保持严格类型检查，避免 `any`；CLI 输出、Webview 消息和配置文件均先校验再转换。
- `package.json` 是公开命令、视图、菜单和配置项的清单；`extension.ts` 中的注册必须与清单一致。仅供视图内部调用的命令可以不展示在命令面板，但应在设计文档中注明。
- 所有 disposable 注册到扩展上下文，或由所属对象明确释放。
- Webview 使用最小权限 CSP、nonce 和本地资源 URI；展示用户数据时使用文本节点或等价转义方式。
- 路径、查询和其他用户输入必须作为独立进程参数传递，禁止拼接 shell 命令。
- 扫描结果由 `IndexDirectoryService` 统一维护，侧边栏和当前面板通过事件同步，不各自维护另一套索引来源。
- 页面状态以 `src/protocol/types.ts` 为准；字段或消息变化时同步更新校验代码。

## 6. Java、SPI 与 Analyzer 规则

- 只通过 `DirectoryReader`、`IndexReader`、`LeafReader` 等公开 API 读取索引。
- 不创建 `IndexWriter`，不删除锁文件，不提供自动修复。
- 每条命令使用 `try-with-resources` 释放 Directory、reader、Analyzer 和其他文件句柄。
- 每个版本插件必须通过 `LucenePlugin.analyzers()` 声明非空的 Analyzer 列表。
- Analyzer ID 必须匹配 `[a-z][a-z0-9_-]{0,63}`，显示名称非空；ID 不得重复。
- 查询和导出只能使用当前插件声明的 Analyzer，禁止按客户端传入的类名反射加载。
- Lucene 9 插件当前声明 `standard`、`keyword`、`whitespace`、`simple`、`cjk` 和 `smartcn`。
- 新增版本插件时，由该插件声明它实际支持的 Analyzer 集合；TypeScript 不维护跨版本静态全集。
- 不反序列化来自索引或客户端的任意 Java 对象。

## 7. CLI 命令与协议

- 调用形式固定为 `java [JVM 参数] -jar <core.jar> --plugin <plugin.jar> <subcommand> [参数] --output json`。
- 当前子命令为 `version`、`probe`、`summary`、`fields`、`documents`、`document`、`query` 和 `export`。
- stdout 只输出一个完整 JSON 响应；stderr 只用于诊断。
- 响应包含 `protocolVersion`、`cliVersion`，以及互斥的 `result` 或 `error`。
- 退出码保持稳定：`0` 成功、`2` 参数错误、`3` 索引或目录错误、`4` 查询或分页错误、`10` 其他内部错误。
- Extension Host 负责超时和取消；取消时终止当前子进程。
- stdout 上限为 16 MiB，stderr 最多保留 1 MiB；不得引入无界输出。
- 文档页大小 CLI 硬上限为 1000；查询和导出同时受 `maxHits` 限制。
- 二进制 stored field 的完整内容最多读取 1 MiB；列表默认不请求完整二进制内容。

## 8. 索引发现与工作区配置

- 自动发现使用 `vscode.workspace.findFiles("**/segments_*")`，并额外排除 `.git`、`node_modules`、`dist`、`target`、`.idea` 和 `.vscode` 目录。
- 每个候选目录都必须经 Lucene 9 插件 `probe` 验证；只有兼容且探测主版本为 9 的索引进入列表。
- 手动选择的索引也必须先通过相同 `probe`，再写入配置。
- 配置文件固定为各工作区目录下的 `.vscode/lucene-lens.json`，当前格式版本为 `1`。
- `manualIndexes` 保存规范化 `file:` URI；工作区外索引保存到第一个 workspace folder。
- `indexes` 保存 Analyzer 设置：工作区内使用相对路径键，工作区外使用 `file:` URI。
- 没有打开 workspace folder 时不得假装保存成功，应向用户说明无法持久化。
- 删除手动索引只删除配置中的引用，不删除磁盘目录；若同一路径仍被自动发现，应保留该索引并去掉手动标记。
- 配置写入必须串行，读取时校验版本、URI、Analyzer ID 和字段映射；无效文件不得被静默覆盖。

## 9. 安全、隐私与日志

- 工作区未受信任时不得启动 CLI 或打开索引。
- 默认离线运行，不上传路径、查询、字段名、字段值或诊断信息。
- 导出必须由用户显式触发并选择 CSV 目标路径。
- 日志写入 `Lucene Lens` Output Channel，默认只记录请求 ID、命令名、耗时、退出码和错误码。
- 不记录查询结果或字段值。`luceneLens.showSensitiveValuesInLogs` 当前仅存在于扩展清单、尚未接入日志实现；接入前必须先更新隐私说明和设计。
- UI 错误信息应简短且给出可执行建议；内部异常可写入诊断日志，但不得泄露字段内容。

## 10. 构建、产物与发布

- `npm run check-types` 执行 TypeScript 类型检查。
- `npm run build:cli` 构建 Maven 多模块。
- `npm run copy:cli` 重建 `dist/cli` 并复制 core 与 Lucene 9 插件 jar。
- `npm run compile` 完成类型检查和 Extension Host/Webview 打包。
- `npm run package` 依次构建 CLI、复制 jar 并编译扩展。
- `npm run vsix` 生成可安装 VSIX。
- `dist/`、Maven `target/` 和 `*.vsix` 都是生成物，不手工维护、不提交 Git。
- VSIX 必须包含完整 `dist/` 与运行所需 `media/`，不得包含 TypeScript/Java 源码和 Maven 中间产物。
- 发布前确认 `package.json`、CLI/plugin 版本、README/CHANGELOG 和发布说明彼此一致。

## 11. 文档与变更

- 功能范围、模块边界、协议、配置、命令或视图变化时，同步更新 `docs/design/plugin-design.md`。
- `implementation-plan.md` 是首版历史基线；若修改，应明确是修正当前状态描述还是制定新的里程碑。
- 文档中的接口示例必须能在当前源码中找到对应字段，未来能力需标记为“未实现”或单独放入后续规划。
- 新增重要文档时更新 `docs/README.md` 和根目录 `AGENTS.md`。
- 未经用户要求，不生成重复总结或过程性临时文档。

## 12. 交付检查

变更完成前至少确认：

- 修改范围与任务一致，没有覆盖用户的无关改动。
- 执行了与变更直接相关的类型检查、构建或文档检查。
- 一次性子进程、reader、事件监听器和 Webview 资源都有释放路径。
- 大数据读取具有分页、超时、取消或硬上限保护。
- 公开命令、配置、协议类型和文档互相一致。
- 文档链接有效，不存在重复、损坏的代码块或把规划当现状的描述。
