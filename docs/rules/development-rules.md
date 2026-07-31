# 开发协作规则

## 1. 适用范围

本规则适用于 Lucene Lens 仓库内的源码、构建配置、资源和文档。根目录 `AGENTS.md` 只负责索引，本文件是具体规则的唯一维护位置。

## 2. 基本原则

1. 优先交付可验证的小步变更，避免在一次提交中混入无关重构。
2. 读取 Lucene 索引时必须默认只读，禁止修改、合并、修复或删除用户索引文件。
3. 使用 Lucene 官方 API 解析索引，不自行实现 Lucene 二进制文件格式。
4. 扩展进程不得执行耗时扫描；每次索引操作通过一次性 Java CLI 命令完成，命令结束后进程立即退出。
5. 所有列表查询必须分页或设置上限，不得把整个索引一次性载入内存。
6. 默认不新增或修改测试用例，除非用户明确要求。

## 3. 目录职责

项目落地后遵循以下职责边界：

```text
src/                    VS Code 扩展 TypeScript 源码
  commands/             命令注册与编排
  services/             CLI 调用、索引目录和配置服务
  views/                侧边栏入口视图
  webview/              Webview 通信与页面装配
  protocol/             TypeScript 侧协议和领域类型
  platform/             日志、文件系统、进程等平台适配
cli/                    Java CLI Maven 多模块工程
  pom.xml               父 POM
  cli-core/             CLI 主程序、service、SPI 和模型
  cli-plugin-lucene-<major>/
                        指定 Lucene 主版本的插件
dist/                   构建和 VSIX 打包产物
  extension/            TypeScript 编译产物
  cli/
    lucene-lens-cli.jar CLI core 可执行 jar
    plugins/lucene-<major>/
                        对应 Lucene 主版本的插件 jar
media/                  Webview 静态资源
docs/design/            技术设计
docs/rules/             开发规则
```

- UI 层不能直接启动进程或访问 Lucene 索引。
- TypeScript 与 Java 之间只通过 `protocol` 中定义的协议通信。
- Java 的 Lucene 对象不能泄漏为协议模型；协议应保持稳定、可版本化。
- `command` 只负责参数解析和调用编排，`service` 负责具体功能实现。
- CLI 的成功结果、错误信息、分页结构和领域数据统一放在 `cli-core/model`，不拆分独立 output 和 error 包。
- 只有 `cli-plugin-lucene-<major>/util` 可以直接调用 `org.apache.lucene.*`。
- CLI core 不得依赖 Lucene；每个插件模块只能依赖一个 Lucene 主版本。
- 首版只实现并打包 Lucene 9 插件；新增其他主版本前必须同步更新设计文档。
- 插件 jar 不得重复打包 core SPI 和 model 类，只包含插件实现及对应 Lucene 依赖。
- CLI core 每次命令只加载一个显式指定的插件，禁止扫描并同时加载所有插件。
- `dist/` 只由构建流程生成，不手工维护，不提交 Git。
- `dist/cli/plugins/lucene-<major>/` 只存放对应版本的插件构建产物，不在其中维护 Java 源码。
- VSIX 必须包含完整 `dist/`，但不得包含 Java 源码、Maven `target/` 等中间文件。

## 4. TypeScript 规则

- 开启严格类型检查，避免 `any`；外部输入先校验再转换为领域类型。
- 命令 ID、视图 ID、配置键集中定义，不散落硬编码字符串。
- 所有 disposable 注册到扩展上下文或明确释放。
- Webview 启用最小权限的 Content Security Policy，并使用 nonce 加载脚本。
- 日志写入专用 Output Channel；面向用户的错误信息应简短并给出可执行建议。
- 路径、命令参数和用户输入不得直接拼接为 shell 命令。

## 5. Java 与 Lucene 规则

- 通过 Lucene 的 `DirectoryReader`、`IndexReader`、`LeafReader` 等公开 API 只读访问索引。
- Lucene API 调用必须封装在插件的版本化 `util` 中，core command、service、SPI 和 model 不得导入 Lucene 类型。
- 打开目录时使用只读语义，不获取写锁，不创建 `IndexWriter`。
- Java CLI 不得常驻；每条命令必须使用 `try-with-resources` 在退出前释放 reader、Directory 和文件句柄。
- 捕获并结构化返回索引不存在、索引损坏、版本不兼容、权限不足等错误。
- 文档、term、stored field、doc values 等高基数数据必须分页，并设置 CLI 硬上限。
- 查询仅允许使用内置的 Standard、Keyword 和 Smart Chinese Analyzer，不得按任意类名动态加载。
- 不反序列化来自索引或客户端的任意 Java 对象。

## 6. 命令与输出规则

- TypeScript 每次操作使用进程 API 的参数数组启动一次 Java CLI，禁止通过 shell 拼接命令。
- Java CLI 采用子命令和显式参数，例如 `summary --index <path> --output json`；标准输入默认不承载交互协议。
- 标准输出只允许输出一个完整 JSON 结果；诊断日志写入标准错误。
- 命令结果包含 `cliVersion`、`protocolVersion` 和结构化的 `result` 或 `error`。
- 退出码必须稳定：成功为 `0`，参数错误、索引错误和内部错误使用不同的非零退出码。
- 扩展负责命令超时和取消；取消时终止当前子进程，不自动重试有副作用或高成本的命令。
- 单次输出设置大小上限；超过上限时返回分页或导出提示，不允许无界传输。
- Java CLI 不提供 daemon、server、会话注册或后台常驻模式。
- Java Runtime 不随插件打包；优先使用配置的 Java Home，未配置时使用系统 `PATH` 中的 `java`，解析出的 Java 不可用或版本不符合要求时提示用户配置。

## 7. 安全与隐私

- 默认不联网，不上传索引内容、字段值、路径或诊断信息。
- 打开索引前向用户展示实际路径；仅访问用户明确选择的目录。
- Webview 展示字段内容时必须转义 HTML，禁止执行索引中的脚本或链接。
- “导出”是显式操作，首版仅支持 CSV，写入前由用户选择目标文件。
- 日志默认不记录完整字段值；必要时仅记录数量、耗时和错误类型。

## 8. 文档与变更

- 功能范围、模块边界或协议发生变化时，更新 `docs/design/plugin-design.md`。
- 新增配置、命令或视图时，在设计文档的对应清单中登记。
- 若实现与文档暂时不一致，应明确标注状态和后续处理项。
- 未经用户要求，不生成重复的总结文档或过程性临时文档。

## 9. 交付检查

变更完成前至少确认：

- 修改范围与任务一致，没有覆盖用户的无关改动。
- 构建、类型检查或与变更直接相关的验证可以通过。
- reader、一次性子进程、事件监听器和 Webview 资源均有释放路径。
- 大数据查询有分页、超时、取消或上限保护。
- 错误信息不会泄露字段内容等敏感数据。
- 相关设计文档和索引链接仍然有效。
