# Lucene Lens 首版执行计划

## 1. 实施基线

- 首版固定使用 Lucene 9.12.3、`lucene-backward-codecs` 和 Java 11，可读取同一主版本的较早默认索引格式。
- VS Code 扩展使用 TypeScript、npm、esbuild 和原生 Webview。
- Java CLI 使用 Maven 多模块、Picocli、Jackson 和 Maven Shade Plugin。
- `cli-core` 不依赖 Lucene；`cli-plugin-lucene-9` 通过 SPI 提供只读能力。
- 首版页面实现文档浏览、查询、详情和 CSV 导出；segment、term 命令及界面延后。
- Java CLI 每次操作启动一个进程，命令完成后立即退出。
- 不考虑浏览期间索引变化；默认不新增自动化测试。

## 2. 执行阶段

1. 建立 TypeScript、Maven、esbuild 和 VSIX 打包骨架。
2. 实现 CLI 协议、命令入口、SPI、错误码及一次性插件加载。
3. 实现 Lucene 9 索引探测、概览、字段、stored fields、doc values、查询分页和 CSV 导出。
4. 实现 Java Home/PATH 探测、CLI 子进程、工作区扫描、手动目录选择、协议校验和页面状态编排。
5. 实现侧边栏索引导航、单例 Webview、版本选择、文档表格、详情、查询和分页。
6. 补齐图标、README、CHANGELOG、构建说明和多平台验证说明。
7. 执行 TypeScript 类型检查、Maven package、VSIX 打包和 CLI 手工冒烟验证。

## 3. 接口约束

- CLI 调用形式为 `java [JVM参数] -jar <core.jar> --plugin <plugin.jar> <subcommand> [参数] --output json`。
- 首版子命令为 `version`、`probe`、`summary`、`fields`、`documents`、`document`、`query`、`export`。
- stdout 只输出一个 `protocolVersion: 1` 的 JSON 响应；stderr 只用于诊断日志。
- 普通文档 cursor 保存下一个内部 doc ID；查询 cursor 保存 `searchAfter` 所需的 score 和 doc ID。
- Webview 只发送索引 ID 和操作意图，不访问文件系统、不启动进程、不接收插件路径。
- CSV 使用 UTF-8、CRLF、表头和标准双引号转义；多值在单元格内以换行分隔。

## 4. 完成标准

- 同一 VSIX 可在 macOS、Windows、Linux 安装。
- Java 优先使用配置的 Java Home，未配置时使用 `PATH`；Java 不可用或低于 11 时给出明确提示。
- 能自动发现工作区中的 Lucene 9 索引并浏览 stored fields 与全部 DocValues 类型。
- 能使用 Standard、Keyword、Smart Chinese Analyzer 查询并分页。
- 能流式导出普通文档和查询结果为 CSV。
- 命令成功、失败、超时或取消后均无常驻 Java 进程和未释放索引句柄。
