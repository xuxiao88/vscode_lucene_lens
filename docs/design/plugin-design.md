# Lucene Lens VS Code 插件设计

## 1. 文档状态

本文描述当前 `0.1.x` 实现，而不是未来愿景。首版执行过程参见 [implementation-plan.md](implementation-plan.md)，强制协作约束参见 [development-rules.md](../rules/development-rules.md)。

当前边界：

- 只读查看本地 Lucene 9 索引。
- 固定使用 Lucene 9.12.3 插件和 `lucene-backward-codecs`。
- 支持工作区自动发现、手动目录持久化、文档浏览、查询、详情和 CSV 导出。
- 不支持 Solr、Elasticsearch/OpenSearch 数据目录、远程索引、segment/term 页面和动态 Lucene 版本切换。

## 2. 总体架构

```text
VS Code command / sidebar
           |
           v
LensPanel + IndexDirectoryService + WorkspaceSettingsService
           |
           v
JavaCommandRunner -- one process per operation
           |
           v
cli-core (Picocli + JSON + PluginLoader)
           |
           v
LucenePlugin SPI
           |
           v
Lucene9Plugin adapter -> Lucene9Util -> Lucene 9 API
```

Extension Host 不持有 Lucene reader。一次用户操作对应一次 Java CLI 进程，处理完成后进程退出并释放资源；不存在后台服务或常驻 Java 进程。

### 2.1 当前目录

```text
src/
  extension.ts
  platform/javaCommandRunner.ts
  protocol/{types,validation}.ts
  services/{indexDirectoryService,workspaceSettingsService}.ts
  views/indexTree.ts
  webview/{lensPanel,main}.ts
cli/
  cli-core/
    .../core/{Main,CliCommand}.java
    .../core/model/
    .../core/spi/{LucenePlugin,PluginLoader}.java
  cli-plugin-lucene-9/
    .../lucene9/adapter/Lucene9Plugin.java
    .../lucene9/util/Lucene9Util.java
    .../META-INF/services/dev.lucenelens.cli.core.spi.LucenePlugin
dist/
  extension/{extension,webview}.js
  cli/lucene-lens-cli.jar
  cli/plugins/lucene-9/lucene-plugin.jar
```

`dist/` 和 Maven `target/` 均由构建生成。当前代码没有独立的 TypeScript `commands/`、Java `command/`、Java `service/` 或 `luceneVersionResolver` 模块。

### 2.2 模块职责

- `extension.ts`：创建依赖、注册 VS Code 命令和配置监听。
- `JavaCommandRunner`：解析 Java、设置堆和超时、启动/取消一次性进程、限制输出并解析 JSON。
- `IndexDirectoryService`：扫描候选目录、执行 `probe`、合并自动和手动索引、维护列表事件。
- `WorkspaceSettingsService`：校验并串行读写 `.vscode/lucene-lens.json`。
- `IndexTree`：渲染侧边栏索引及手动索引删除入口。
- `LensPanel`：维护单例页面、页面状态、CLI 调用和导出编排。
- `webview/main.ts`：渲染状态和发送用户操作，不直接访问 Node.js 或 VS Code API。
- `cli-core`：Picocli 参数、SPI 加载、公共校验、JSON 响应和退出码，不依赖 Lucene。
- `Lucene9Plugin`：声明插件版本、Lucene 版本和 Analyzer，转发 SPI 调用。
- `Lucene9Util`：只读打开 Lucene 9 索引并实现字段、文档、查询和导出。

## 3. VS Code 接口

### 3.1 命令

| 命令 ID | 用途 |
| --- | --- |
| `luceneLens.open` | 打开或聚焦 Lucene Lens 页面 |
| `luceneLens.openIndex` | 侧边栏内部调用，按索引 ID 打开页面；不在命令面板展示 |
| `luceneLens.chooseIndexDirectory` | 手动选择、验证并保存索引目录 |
| `luceneLens.removeIndex` | 删除手动引用，不删除索引文件 |
| `luceneLens.refreshIndexes` | 刷新侧边栏索引 |
| `luceneLens.rescanWorkspace` | 从页面重新扫描并同步侧边栏 |
| `luceneLens.export` | 导出当前文档或查询结果 |
| `luceneLens.showLogs` | 打开 `Lucene Lens` Output Channel |

`openIndex` 由视图项调用。`removeIndex` 虽在扩展清单中贡献，但通过菜单条件从命令面板隐藏，只显示在手动索引项上。

### 3.2 配置

| 配置键 | 默认值 | 当前用途 |
| --- | --- | --- |
| `luceneLens.java.home` | 空 | Java Home；为空时使用 `PATH` 中的 `java` |
| `luceneLens.cli.maxHeap` | `512m` | 每个 CLI 子进程的最大堆 |
| `luceneLens.pageSize` | `50` | 初始页大小，可选 25、50、100、200 |
| `luceneLens.query.maxHits` | `10000` | 查询和导出命中上限 |
| `luceneLens.query.analyzer` | `standard` | 首选默认 Analyzer |
| `luceneLens.requestTimeout` | `30000` | CLI 超时，单位毫秒 |
| `luceneLens.showSensitiveValuesInLogs` | `false` | 预留项；当前日志实现不读取该值，也不记录字段值 |

## 4. 索引发现与持久化

### 4.1 自动发现

1. 在已打开工作区中查找 `**/segments_*`。
2. 过滤路径中包含 `.git`、`node_modules`、`dist`、`target`、`.idea` 或 `.vscode` 的候选。
3. 将 segment 文件的父目录去重。
4. 使用固定的 Lucene 9 插件执行 `probe`。
5. 只保留 `compatible: true` 且 `detectedLuceneMajor: 9` 的目录。

扫描依赖 `vscode.workspace.findFiles` 的默认排除行为，并额外执行上述固定目录过滤；代码没有单独读取或合并 `files.exclude`、`search.exclude`。

### 4.2 手动添加与删除

- 用户选择目录后先执行相同 `probe`，验证成功才加入列表。
- 手动目录以 `file:` URI 写入工作区 `.vscode/lucene-lens.json`。
- 工作区内索引写入所属 workspace folder；工作区外索引写入第一个 workspace folder。
- 没有 workspace folder 时无法保存，操作会给出错误。
- 删除按钮只移除 `manualIndexes` 引用。若同一路径也由自动扫描发现，它继续显示，但 `manuallyAdded` 变为 `false`。

### 4.3 配置文件

当前格式版本为 `1`：

```json
{
  "version": 1,
  "manualIndexes": [
    "file:///absolute/path/to/manual-index"
  ],
  "indexes": {
    "relative/path/to/index": {
      "analyzer": "standard",
      "fieldAnalyzers": {
        "content": "smartcn"
      }
    }
  }
}
```

工作区内索引的 Analyzer 配置使用相对路径，工作区根目录使用 `"."`；外部索引使用 `file:` URI。读取时严格校验结构。写入通过队列串行执行，避免相互覆盖。

## 5. Java CLI 与插件

### 5.1 进程模型

调用形式：

```text
java -Xmx<heap> -jar dist/cli/lucene-lens-cli.jar \
  --plugin dist/cli/plugins/lucene-9/lucene-plugin.jar \
  <subcommand> [arguments] --output json
```

- 使用 `spawn` 参数数组，`shell: false`。
- 首次调用解析并缓存 Java 路径与主版本；配置变化时清除缓存。
- 要求 Java 11 或更高版本。
- 普通超时取 `luceneLens.requestTimeout`，取消或超时会终止子进程。
- stdout 最大 16 MiB，stderr 最多保留 1 MiB。
- 扩展销毁时终止仍在运行的子进程。

### 5.2 插件加载

`PluginLoader` 为显式 `--plugin` jar 创建一个 `URLClassLoader`，通过 `ServiceLoader` 加载 `LucenePlugin`：

- 必须且只能发现一个 SPI 实现。
- Analyzer 列表必须非空，ID 和 label 必须合法且 ID 唯一。
- 命令结束时关闭 class loader。
- core 不扫描 `dist/cli/plugins`，也不同时加载多个版本。

当前 Extension Host 固定传入 Lucene 9 插件路径。新增版本模块本身并不会自动出现在 UI 中，还需要先设计并实现插件发现与版本选择。

### 5.3 Analyzer 声明

Analyzer 能力由插件返回，不由 Extension Host 硬编码。Lucene 9 插件当前声明：

| ID | 显示名称 |
| --- | --- |
| `standard` | Standard |
| `keyword` | Keyword |
| `whitespace` | Whitespace |
| `simple` | Simple |
| `cjk` | CJK |
| `smartcn` | Smart Chinese |

`version` 返回该列表。页面只展示插件声明的 Analyzer；查询和导出前，core 再次拒绝未声明的 ID。

### 5.4 子命令

| 子命令 | 作用 |
| --- | --- |
| `version` | 返回 CLI、协议、Java、插件、Lucene 版本和 Analyzer 列表 |
| `probe` | 检查目录能否由当前插件只读打开 |
| `summary` | 返回索引概览；当前 UI 未单独展示该结果 |
| `fields` | 返回查询所需字段名和 `indexed` 标记 |
| `documents` | 按内部 doc ID cursor 分页读取文档 |
| `document` | 读取单个文档详情 |
| `query` | 使用 Query Parser 和 `searchAfter` 分页查询 |
| `export` | 将普通文档或查询结果流式写为 CSV |

首版不实现 `segments` 和 `terms`。

### 5.5 响应与退出码

成功：

```json
{
  "protocolVersion": 1,
  "cliVersion": "0.1.0",
  "result": {}
}
```

失败：

```json
{
  "protocolVersion": 1,
  "cliVersion": "0.1.0",
  "error": {
    "code": "INDEX_VERSION_UNSUPPORTED",
    "message": "The index version is not supported by this Lucene plugin.",
    "retryable": false
  }
}
```

stdout 只包含一个 JSON 对象，stderr 用于诊断。退出码为：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数错误 |
| `3` | 目录、索引、权限、损坏或版本错误 |
| `4` | 查询、文档 ID 或分页错误 |
| `10` | 其他内部错误 |

## 6. 查询、分页与数据

### 6.1 查询

- 未输入查询时调用 `documents`；有查询时调用 `query`。
- 未指定字段时使用索引中的可查询字段构建 `MultiFieldQueryParser`。
- 默认 Analyzer 优先使用 `luceneLens.query.analyzer`；若插件未声明该 ID，使用声明列表第一项。
- 字段级覆盖通过重复的 `--field-analyzer <field> <id>` 传递，并由 `PerFieldAnalyzerWrapper` 应用。
- Analyzer 变化后清除 cursor 并回到第一页。
- 查询结果与查询导出使用同一套 Analyzer 设置。

### 6.2 分页与限制

- 页面大小为 25、50、100 或 200；CLI 的 `limit` 允许范围为 1 到 1000。
- 普通文档 cursor 表示下一内部 doc ID。
- 查询 cursor 保存 `searchAfter` 所需的 score 和 doc ID。
- `total` 使用字符串，避免跨语言整数精度问题。
- `totalRelation` 为 `exact` 或 `lowerBound`；达到 `maxHits` 时可以返回下界。
- Webview 只渲染当前页，Extension Host 保存已访问页的 cursor 以支持上一页。
- 导出在 Java 侧流式写入，避免把完整 CSV 放入 stdout 或 Extension Host 内存。

### 6.3 文档值

```ts
type StoredValue =
  | {type: "string"; value: string}
  | {type: "int" | "long" | "float" | "double"; value: string}
  | {type: "binary"; base64?: string; byteLength: number};

type DocValue =
  | {type: "numeric" | "sortedNumeric"; values: string[]}
  | {type: "binary" | "sorted" | "sortedSet"; values: BytesValue[]};

interface DocumentRow {
  docId: number;
  score?: number;
  storedFields: Record<string, StoredValue[]>;
  docValues: Record<string, DocValue>;
}
```

数值以字符串跨协议传输。同名 stored field 保留多值。二进制内容受 1 MiB 上限保护，列表请求默认只返回必要信息。

## 7. TypeScript 状态与协议

关键结构以 `src/protocol/types.ts` 为唯一源码事实：

```ts
interface ResolvedIndex {
  id: string;
  absolutePath: string;
  displayName: string;
  description: string;
  detectedLuceneMajor: number;
  manuallyAdded: boolean;
}

interface FieldSummary {
  name: string;
  indexed: boolean;
}

interface ProbeResult {
  detectedLuceneMajor: number;
  pluginLuceneMajor: number;
  compatible: boolean;
  createdVersion?: string;
}

interface LensPageState {
  status: PageStatus;
  selectedIndexId?: string;
  selectedLuceneMajor?: number;
  rows: DocumentRow[];
  pageNumber: number;
  pageSize: 25 | 50 | 100 | 200;
  total: string;
  totalRelation: "exact" | "lowerBound";
  query: string;
  analyzer: string;
  analyzers: AnalyzerDefinition[];
  searchableFields: string[];
  fieldAnalyzers: Record<string, string>;
  hasPrevious: boolean;
  hasNext: boolean;
  error?: string;
}
```

Webview 可发送 `ready`、`rescan`、`search`、Analyzer 设置、分页、文档详情和导出意图。Extension Host 只发送完整页面状态、文档详情或通知。所有入站消息都经过 `validation.ts` 校验。

## 8. 页面交互

### 8.1 侧边栏

- Activity Bar 中的 `Lucene Lens / Indexes` 是索引导航入口。
- 点击索引打开单例页面并选择该索引。
- 标题栏提供手动选择目录和刷新。
- 只有手动索引项显示删除按钮。
- 自动扫描与手动引用按绝对路径去重。

### 8.2 主页面

- 顶部展示固定且不可编辑的 `Lucene 9` 版本标识、查询框、Query Settings 和导出按钮。
- 页面不重复提供索引选择器，索引由侧边栏驱动。
- Query Settings 将默认 Analyzer 与字段覆盖紧凑排列；字段规则可添加和删除。
- 表格显示当前页 stored fields 和 doc values，点击行查看完整详情。
- 页脚提供页大小、上一页和下一页。

页面状态包括 `untrusted`、`scanning`、`empty`、`loading`、`ready`、`error` 和 `cancelled`。工作区未受信任时不启动 CLI；取消时停止 loading，不把取消当普通错误弹出。

## 9. 安全、隐私与日志

- 索引始终只读打开，不创建 writer、不获取写锁、不修复文件。
- 路径和查询通过进程参数数组传递，不经过 shell。
- Webview 使用 CSP 和 nonce，用户数据按文本展示。
- 默认离线运行，不上传索引信息。
- CSV 导出由用户显式选择目标。
- 每个请求记录 request ID、命令名、耗时、退出码和错误码。
- 当前实现不记录结果条数、查询结果或字段值；`showSensitiveValuesInLogs` 尚未接入。

## 10. 构建与验证

构建链路：

```text
npm run build:cli
  -> mvn -f cli/pom.xml clean package
npm run copy:cli
  -> dist/cli
npm run compile
  -> tsc --noEmit + esbuild
npm run package
  -> build:cli + copy:cli + compile
npm run vsix
  -> package + vsce package
```

当前仓库没有 lint 脚本。默认验证应从以下命令中选择与改动相称的集合：

```bash
npm run check-types
mvn -f cli/pom.xml package
npm run package
npm run vsix
```

默认不新增或修改测试用例。涉及 CLI 协议、资源释放、查询或打包时，应补充相应手工冒烟验证，并确认命令结束后没有常驻 Java 进程。

## 11. 后续扩展条件

以下能力尚未实现，不能仅通过复制一个插件模块完成：

- 动态扫描 `dist/cli/plugins/lucene-<major>`。
- 多插件探测顺序和失败分类。
- 数据版本与兼容插件的选择策略。
- Webview 版本候选列表和手动切换。
- 多版本下 Analyzer 配置迁移。

开始多版本工作前，必须先确定上述行为以及协议兼容策略，再更新目录、状态模型和打包流程。每个新增版本插件仍需自行实现 SPI，并声明它支持的 Analyzer 列表。
