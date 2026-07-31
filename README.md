# Lucene Lens

Lucene Lens 是一个用于桌面版 Visual Studio Code 的只读 Lucene 9 索引查看器。插件自动扫描当前工作区中的索引目录，展示 stored fields 和 DocValues，执行有上限的查询，并将结果导出为 CSV。

## 运行要求

- Visual Studio Code 1.90 或更高版本
- Java 11 或更高版本
- 由 Lucene 9 创建的本地索引

插件基于 Lucene 9.12.3，并打包 backward codecs 以读取由较早 Lucene 9.x 默认 codec 创建的索引。

Lucene Lens 优先使用 `luceneLens.java.home`。未配置时使用 `PATH` 中的 `java`。插件不打包 Java Runtime，也不会启动常驻 Java 进程。

## 使用方式

1. 打开包含 Lucene 索引目录的受信任工作区。
2. 点击 Activity Bar 中的 Lucene Lens 图标。
3. 在 **Indexes** 中点击要查看的索引，直接打开对应页面。
4. 浏览文档、输入 Lucene Query Parser 表达式，或将当前结果导出为 CSV。

侧边栏标题栏的目录按钮可手动选择工作区内外的 Lucene 索引目录，刷新按钮可重新扫描工作区索引；主页面重新扫描后，侧边栏列表也会同步更新。正式页面不再重复提供索引下拉框。

首版版本下拉只有 Lucene 9。索引始终以只读方式打开。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `luceneLens.java.home` | 空 | Java Home；未配置时使用 `PATH` 中的 `java` |
| `luceneLens.cli.maxHeap` | `512m` | 每个 CLI 进程的最大堆 |
| `luceneLens.pageSize` | `50` | 默认分页大小 |
| `luceneLens.query.maxHits` | `10000` | 查询命中跟踪与导出上限 |
| `luceneLens.query.analyzer` | `standard` | `standard`、`keyword` 或 `smartcn` |
| `luceneLens.requestTimeout` | `30000` | 请求超时，单位毫秒 |

## 构建

```bash
npm install
npm run package
npm run vsix
```

`npm run package` 构建 Maven CLI 模块，将 jar 复制到 `dist/cli`，执行 TypeScript 类型检查，并打包 Extension Host 和 Webview。

## 故障排查

- **找不到 Java：** 将 `luceneLens.java.home` 配置为 Java 11+ 的安装目录。
- **索引版本不支持：** 首版只接受由 Lucene 9 创建的索引。
- **没有发现索引：** 确认工作区已受信任，且未被排除的目录中存在 `segments_*` 文件。
- **查看更多诊断信息：** 执行 **Lucene Lens: Show Lucene Lens Logs**。

## 隐私与安全

Lucene Lens 默认离线运行，不上传索引路径、查询、字段名、字段值或诊断信息。插件不会创建 `IndexWriter`、获取写锁、修复索引或修改索引文件。
