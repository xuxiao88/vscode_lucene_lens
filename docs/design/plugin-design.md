# Lucene Lens VS Code 插件设计

## 1. 介绍

Lucene Lens 是一个只读查看本地 Lucene 索引的 VS Code 插件。首版支持查看索引概览和字段能力，在页面中浏览 stored fields 与 doc values，执行受限查询，并将结果导出为 CSV。

插件只处理用户选择的本地 Lucene 索引目录，不修改、合并或修复索引，不直接支持 Solr、Elasticsearch/OpenSearch 数据目录和远程索引。

## 2. 技术设计

### 2.1 项目目录架构

```text
vscode_lucene_lens/
├── src/                              VS Code 扩展源码
│   ├── commands/                     VS Code 命令
│   ├── services/                     CLI 调用、版本选择、目录和配置服务
│   ├── protocol/                     CLI 输出协议和领域模型
│   ├── views/                        侧边栏入口视图
│   ├── webview/                      Webview 面板与消息处理
│   └── platform/                     日志、Java 探测、进程等平台能力
├── cli/                              Java CLI Maven 多模块工程
│   ├── pom.xml                       父 POM，统一插件和公共依赖版本
│   ├── cli-core/                     CLI 主程序
│   │   ├── pom.xml
│   │   └── src/main/java/dev/lucenelens/cli/core/
│   │       ├── command/              命令参数和调用编排
│   │       ├── service/              功能的具体实现
│   │       ├── spi/                  Lucene 插件接口和加载逻辑
│   │       └── model/                结果、错误和领域数据
│   └── cli-plugin-lucene-<major>/    每个受支持主版本一个插件模块
│       ├── pom.xml                   只依赖一个 Lucene 主版本
│       └── src/
│           ├── main/java/dev/lucenelens/cli/plugin/lucene<major>/
│           │   ├── adapter/          core SPI 的版本实现
│           │   └── util/             直接调用该版本 Lucene API
│           └── main/resources/META-INF/services/
│                                       Java SPI 注册
├── dist/                             构建和 VSIX 打包产物
│   ├── extension/                    TypeScript 编译产物
│   └── cli/
│       ├── lucene-lens-cli.jar       CLI core 可执行 jar
│       └── plugins/
│           └── lucene-<major>/       对应主版本的 Lucene 插件 jar
│               └── lucene-plugin.jar
├── media/                            图标、样式和 Webview 静态资源
├── docs/
│   ├── design/                       技术设计
│   ├── rules/                        开发规则
│   └── README.md                     文档索引
├── package.json                      扩展清单、命令、配置和构建脚本
├── tsconfig.json                     TypeScript 配置
├── .gitignore                        忽略 dist 和各模块 target
├── .vscodeignore                     VSIX 文件过滤
└── AGENTS.md                         项目文档入口
```

目录约束：

- `<major>` 是 Lucene 主版本号占位符；首版只创建 `cli-plugin-lucene-9/` 和 `dist/cli/plugins/lucene-9/`，后续增加主版本时沿用相同结构。
- `src/` 只包含 VS Code 扩展逻辑，不直接依赖 Lucene。
- `cli/` 是独立 Maven 多模块工程，只负责单次 Lucene 读取命令。
- `cli-core` 是 CLI 主体，负责命令、service、插件加载、JSON 输出和退出码，不依赖任何 Lucene 版本。
- `cli-core/command` 只解析参数和编排调用，不直接访问 Lucene。
- `cli-core/service` 放置功能的具体实现，负责参数规则、分页规则和结果组装。
- `cli-core/model` 统一放置成功结果、错误信息、分页结构和领域数据，不再拆分 output、error、model 包。
- CLI 公共入口统一完成 JSON 序列化、异常转换和退出码设置。
- `cli-core/spi` 定义版本无关的插件接口，方法参数和返回值只能使用 core model，不能暴露 Lucene 类型。
- `cli-plugin-lucene-<major>/util` 是唯一允许直接导入和调用 `org.apache.lucene.*` 的位置。
- 调用方向固定为 `command -> service -> spi <- plugin adapter -> util -> Lucene API`。
- 插件 `adapter` 负责把 core SPI 适配到当前版本的 util；service 不通过版本判断或反射选择实现。
- 每个 `cli-plugin-lucene-<major>` 只依赖一个 Lucene 主版本，并生成包含该版本 Lucene 运行依赖的插件 jar。
- 首版 Lucene 9 插件包含 Query Parser、通用 Analyzer 和 Smart Chinese Analyzer 所需依赖。
- 插件构建时不能把 `cli-core` 类打进插件 jar；core SPI 由父 class loader 提供，插件 jar 只包含插件实现和 Lucene 依赖。
- CLI core 每次运行只加载用户指定的一个插件 jar，不扫描或同时加载其他版本插件。
- `dist/` 完全由构建流程生成，不手工维护，也不提交 Git。
- `dist/cli/lucene-lens-cli.jar` 是唯一可执行 CLI；`dist/cli/plugins/` 只存放版本插件。
- `media/` 不放业务逻辑，Webview 的数据请求统一经过扩展进程。
- TypeScript 与 Java 共享的是 JSON 协议定义，不共享源代码或运行时对象。
- 构建顺序为：构建 CLI core、构建所有版本插件、复制到 `dist/cli/`、编译 TypeScript 到 `dist/extension/`、打包 VSIX。
- `.vscodeignore` 必须排除源码和中间文件，但不能排除 VSIX 运行所需的 `dist/`。

### 2.2 命令与配置

#### 2.2.1 命令列表

插件功能以 VS Code 命令组织：

| 命令 ID | 标题 | 功能说明 |
| --- | --- | --- |
| `luceneLens.open` | Open Lucene Lens | 由侧边栏按钮调用，在编辑区打开或聚焦 Lucene Lens 页面 |
| `luceneLens.rescanWorkspace` | Rescan Workspace Indexes | 重新扫描当前工作区中的 Lucene 索引目录并更新页面下拉选项 |
| `luceneLens.export` | Export Results | 将当前文档或查询结果导出为 CSV |
| `luceneLens.showLogs` | Show Lucene Lens Logs | 查看命令耗时、结果数量、错误码和诊断日志 |

索引选择、搜索、查看文档和分页属于页面内部交互，不单独注册 VS Code 命令。耗时操作通过 VS Code 进度通知取消；目录、权限、索引损坏、版本不兼容和查询语法错误直接显示在页面中。

#### 2.2.2 CLI 命令协议

##### 2.2.2.1 调用形式

扩展使用进程 API 的参数数组调用，不经过 shell：

```text
java -Xmx512m -jar dist/cli/lucene-lens-cli.jar \
  --plugin dist/cli/plugins/lucene-<major>/lucene-plugin.jar \
  documents \
  --index /absolute/path/to/index \
  --cursor 100 \
  --limit 100 \
  --output json
```

路径和查询内容均作为独立参数传递。标准输入默认关闭，不用于维护交互会话。

core 根据 `--plugin` 创建独立 class loader，通过 Java `ServiceLoader` 获取 SPI 实现；每次进程只加载一个插件，并在命令结束时关闭 class loader。

成功时 stdout 输出一个 JSON 对象：

```json
{
  "protocolVersion": 1,
  "cliVersion": "0.1.0",
  "result": {
    "items": [
      { "term": "lucene", "docFreq": 12 }
    ],
    "nextCursor": "bHVjZW5l",
    "hasMore": true
  }
}
```

失败时 stdout 仍输出一个结构化 JSON 对象，同时以非零退出码结束：

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

stderr 仅记录诊断日志。若进程被强制终止、JVM 无法启动或 stdout 不是合法 JSON，扩展应产生自己的 `PROCESS_*` 错误。

##### 2.2.2.2 子命令

| 子命令 | 作用 |
| --- | --- |
| `version` | 返回 CLI、协议和 Lucene 版本 |
| `probe` | 检查指定插件能否只读打开索引，并返回数据版本、插件版本和兼容性 |
| `summary` | 获取索引概览并验证目录 |
| `fields` | 获取字段能力 |
| `documents` | 分页读取文档的 stored fields 和 doc values |
| `document` | 读取一个文档的 stored fields 和 doc values 详情 |
| `query` | 执行受限查询 |
| `export` | 将文档或查询结果以 CSV 流式导出到显式目标文件 |

侧边栏打开页面、工作区重扫、切换下拉选项和翻页属于 TypeScript/Webview 编排，不要求存在同名 CLI 子命令。

首版不实现 `segments`、`terms` 子命令及对应界面；后续增加时再扩展协议和页面导航。

##### 2.2.2.3 退出码与错误码

建议退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或协议错误 |
| `3` | 索引目录、权限、损坏或版本错误 |
| `4` | 查询或分页错误 |
| `10` | 未分类内部错误 |

至少定义：

- `INVALID_REQUEST`
- `DIRECTORY_NOT_FOUND`
- `DIRECTORY_NOT_READABLE`
- `NOT_A_LUCENE_INDEX`
- `INDEX_CORRUPT`
- `INDEX_VERSION_UNSUPPORTED`
- `LUCENE_PLUGIN_NOT_AVAILABLE`
- `LUCENE_PLUGIN_LOAD_FAILED`
- `LUCENE_PLUGIN_API_INCOMPATIBLE`
- `LUCENE_VERSION_DETECTION_FAILED`
- `FIELD_NOT_FOUND`
- `QUERY_PARSE_ERROR`
- `LIMIT_EXCEEDED`
- `REQUEST_TIMEOUT`
- `REQUEST_CANCELLED`
- `JAVA_HOME_INVALID`
- `JAVA_NOT_FOUND`
- `JAVA_VERSION_UNSUPPORTED`
- `INTERNAL_ERROR`

#### 2.2.3 配置项

| 配置键 | 默认值 | 用途 |
| --- | --- | --- |
| `luceneLens.java.home` | 空 | 可选的 Java Home（JDK 安装目录）；未配置时使用系统 `PATH` 中的 `java` |
| `luceneLens.cli.maxHeap` | `512m` | 单次 Java CLI 命令最大堆 |
| `luceneLens.pageSize` | `50` | 默认分页大小 |
| `luceneLens.query.maxHits` | `10000` | 单次查询允许遍历的最大命中数 |
| `luceneLens.query.analyzer` | `standard` | 搜索使用的内置 Analyzer，可选 `standard`、`keyword` 或 `smartcn` |
| `luceneLens.requestTimeout` | `30000` | 普通请求超时，单位毫秒 |
| `luceneLens.showSensitiveValuesInLogs` | `false` | 是否允许日志记录字段值 |

所有分页参数还应有 CLI 硬上限，不能仅依赖 VS Code 配置。

### 2.3 交互设计

#### 2.3.1 侧边栏入口

Activity Bar 增加 `Lucene Lens` 图标。对应的侧边栏视图保持简单，只提供一个 `Open Lucene Lens` 按钮：

1. 点击按钮执行 `luceneLens.open`。
2. 如果页面尚未打开，在编辑区创建一个 Webview 页面。
3. 如果页面已经打开，直接聚焦现有页面，不重复创建。
4. 页面首次打开时立即扫描当前工作区。

#### 2.3.2 页面布局

页面使用“顶部工具栏 + 数据表格 + 页脚分页”的固定结构：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [ 索引目录 ▼ ] [ Lucene 9 (Data) ▼ ]              [ 搜索框      ] │
├──────────────────────────────────────────────────────────────────────┤
│ doc ID │ score │ field_a │ field_b │ field_c │ ...                 │
│────────┼───────┼─────────┼─────────┼─────────┼─────────────────────│
│  101   │ 1.24  │ ...     │ ...     │ ...     │                     │
│  102   │ 0.98  │ ...     │ ...     │ ...     │                     │
│  ...                                                               │
├──────────────────────────────────────────────────────────────────────┤
│ 共 1,240 条       每页 [50 ▼]       [上一页]  第 2 页  [下一页]    │
└──────────────────────────────────────────────────────────────────────┘
```

- 顶部左侧是索引目录下拉选项。
- 索引目录下拉右侧是 Lucene 版本下拉选项。
- 顶部右侧是当前索引的搜索框。
- 中间区域使用普通表格展示文档数据。
- 页脚固定展示结果数量、每页条数、当前页和翻页按钮。
- 页面尺寸变化时，搜索框优先伸缩；索引下拉保持可识别当前目录的最小宽度。

#### 2.3.3 工作区扫描

页面打开后执行以下扫描流程：

1. 检查当前工作区是否受信任；未受信任时不启动 Java CLI。
2. 使用 VS Code Workspace API 在所有 workspace folder 中查找 `segments_*` 文件。
3. 排除 `.git`、`node_modules`、`dist`、`target` 以及工作区 `files.exclude`、`search.exclude` 配置命中的目录。
4. 将 `segments_*` 的父目录去重，得到候选 Lucene 索引目录。
5. 对每个候选目录执行 `probe`，验证索引并读取索引数据的 Lucene 主版本。
6. 将数据版本与 `dist/cli/plugins/` 中已有插件匹配，生成该索引可选择的版本列表。
7. 验证成功的目录加入顶部下拉选项；无效目录不展示，错误写入 Output Channel。
8. 多根工作区使用“工作区名称 / 相对路径”作为显示文本，绝对路径作为内部唯一标识。

扫描期间索引下拉框显示 `Scanning workspace...`，版本下拉和搜索框均禁用。扫描完成后：

- 有索引时默认选择第一个，并加载第一页文档。
- 没有索引时表格区域显示 `No Lucene indexes found in the current workspace.`。
- 用户执行 `luceneLens.rescanWorkspace` 时清空旧扫描结果并重新执行上述流程。

#### 2.3.4 索引选择

用户切换顶部下拉选项时：

1. 取消当前索引尚未完成的搜索或分页进程。
2. 清空搜索框、表格和分页状态。
3. 更新 Lucene 版本下拉，默认选中与索引数据主版本相同的插件。
4. 使用默认插件加载新索引的字段信息和第一页文档。
5. 根据 stored fields 和 doc values 生成表格列。
6. 二进制字段仅展示 `[binary: N bytes]`，不直接展开完整内容。

每个下拉选项保留绝对路径作为 tooltip，避免同名目录无法区分。

#### 2.3.5 Lucene 版本选择

- 版本下拉只列出 `dist/cli/plugins/` 中实际存在的 Lucene 主版本插件。
- 首版只打包 Lucene 9 插件，因此版本下拉首版只有 Lucene 9；后续加入插件后自动增加对应选项。
- 默认选中索引数据自身的主版本，并在选项中标记 `Data version`。
- 如果没有与数据版本完全一致的插件，则选择第一个通过 `probe` 的兼容插件，并在下拉旁显示提示。
- 用户可以手动选择其他版本插件；切换前先使用目标插件执行 `probe`。
- 目标插件不兼容时保持原选择和表格内容，并在版本下拉下方显示错误。
- 目标插件兼容时取消当前请求，清空查询和分页状态，然后使用新插件重新加载字段和第一页文档。
- 手动选择只对当前索引和当前页面会话生效，不修改索引数据，也不改变其他索引的版本选择。

#### 2.3.6 搜索

- 搜索框只作用于当前下拉选中的索引。
- 按 Enter 或点击搜索图标后执行查询。
- 空搜索内容表示取消查询并恢复普通文档浏览。
- 查询使用 Lucene Query Parser；语法错误显示在搜索框下方，不清空现有表格。
- 新搜索总是从第一页开始，并取消上一次尚未完成的查询。
- 搜索结果表格固定展示 `doc ID` 和 `score`，其余列展示 stored fields 和 doc values。

#### 2.3.7 表格与分页

- 普通浏览按内部 doc ID 排序；查询结果按 score 排序。
- 表头固定，表格内容区域独立滚动。
- 字段较多时允许横向滚动，不压缩到无法阅读。
- 单元格内容单行截断，点击行后在页面右侧或弹层中查看完整文档详情。
- 同一字段同时存在 stored field 和 doc values 时分别显示，并在列名或详情中标明数据来源。
- 默认每页 50 条，可选 25、50、100、200。
- 页脚提供上一页和下一页；第一页禁用上一页，没有更多结果时禁用下一页。
- 切换每页条数后回到第一页。
- 翻页只替换表格数据，不重新扫描工作区，也不重新探测 Lucene 版本。

#### 2.3.8 页面状态

页面至少处理以下状态：

| 状态 | 页面表现 |
| --- | --- |
| 工作区未受信任 | 不启动 CLI，提示用户信任工作区后重试 |
| 扫描中 | 禁用下拉和搜索，表格显示 loading |
| 未发现索引 | 显示空状态和重新扫描入口 |
| 正在加载数据 | 保留页面框架，表格显示 loading |
| 版本插件不兼容 | 保留原版本和表格，在版本下拉下方显示错误 |
| 查询语法错误 | 搜索框下方显示错误，保留上一次成功结果 |
| 索引读取错误 | 表格区域显示错误和重试入口 |
| CLI 被取消 | 停止 loading，不弹出错误通知 |

### 2.4 数据结构

TypeScript 与 Java 通过 JSON 交换数据。协议模型不能包含 Lucene 运行时对象。插件路径只保留在 Extension Host；索引绝对路径仅作为下拉选项 tooltip 发送给 Webview。

#### 2.4.1 工作区索引

Extension Host 内部使用以下结构保存扫描和版本匹配结果：

```ts
interface ResolvedIndex {
  id: string;
  workspaceFolder: string;
  relativePath: string;
  absolutePath: string;
  displayName: string;
  detectedLuceneMajor: number;
  selectedLuceneMajor: number;
  plugins: LucenePluginRef[];
  summary?: IndexSummary;
}

interface LucenePluginRef {
  major: number;
  pluginPath: string;
  compatibility: "unknown" | "compatible" | "incompatible";
}
```

发送给 Webview 下拉框时转换为精简结构，避免暴露插件路径：

```ts
interface IndexOption {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  detectedLuceneMajor: number;
}

interface VersionOption {
  major: number;
  label: string;
  isDataVersion: boolean;
  compatibility: "unknown" | "compatible" | "incompatible";
}
```

`LucenePluginRef` 只存在于 Extension Host。Webview 只接收不包含插件路径的 `VersionOption`。

#### 2.4.2 索引与字段

```ts
interface IndexSummary {
  numDocs: number;
  maxDoc: number;
  deletedDocs: number;
  segmentCount: number;
  createdVersion?: string;
  commitGeneration?: string;
  commitUserData: Record<string, string>;
}

interface FieldSummary {
  name: string;
  indexed: boolean;
  indexOptions?: string;
  docValuesType?: string;
  hasTermVectors: boolean;
  pointDimensionCount: number;
  variesBySegment: boolean;
}
```

`commitGeneration` 使用字符串传输，避免 Java `long` 超出 JavaScript 安全整数范围。字段能力由 CLI 合并所有 segment 后返回。Lucene 的 `FieldInfo` 不记录字段是否 stored，因此 stored fields 以实际文档读取结果为准，不在字段能力接口中推断。

#### 2.4.3 文档与表格

stored field 需要保留原始类型，并支持同名字段出现多次。doc values 按 Lucene 类型读取，字节类值使用可展示文本或 Base64 表示：

```ts
type StoredValue =
  | { type: "string"; value: string }
  | { type: "int" | "long" | "float" | "double"; value: string }
  | { type: "binary"; base64?: string; byteLength: number };

interface BytesValue {
  text?: string;
  base64?: string;
  byteLength: number;
}

type DocValue =
  | { type: "numeric" | "sortedNumeric"; values: string[] }
  | { type: "binary" | "sorted" | "sortedSet"; values: BytesValue[] };

interface DocumentRow {
  docId: number;
  score?: number;
  storedFields: Record<string, StoredValue[]>;
  docValues: Record<string, DocValue>;
}

interface TableColumn {
  field: string;
  label: string;
  source: "stored" | "docValues";
  valueType: string;
}
```

数值使用字符串传输；二进制值在列表中只返回长度，查看详情时才按大小限制读取内容。表格列取 stored fields 与 doc values 的并集。

#### 2.4.4 分页

CLI 使用 cursor 返回下一页，Webview 使用页码展示：

```ts
interface PageResult<T> {
  items: T[];
  total: string;
  totalRelation: "exact" | "lowerBound";
  nextCursor?: string;
  hasMore: boolean;
}

interface PageState {
  pageNumber: number;
  pageSize: 25 | 50 | 100 | 200;
  query: string;
  cursors: Record<number, string | undefined>;
}
```

Extension Host 保存已经访问过的页码与 cursor 映射，用于上一页和下一页。项目不考虑浏览期间索引变化，因此 cursor 不绑定 commit。`totalRelation` 为 `lowerBound` 时，页面将总数显示为“至少 N 条”。

#### 2.4.5 页面状态

```ts
type PageStatus =
  | "untrusted"
  | "scanning"
  | "empty"
  | "loading"
  | "ready"
  | "error"
  | "cancelled";

interface LensPageState {
  status: PageStatus;
  indexes: IndexOption[];
  selectedIndexId?: string;
  versions: VersionOption[];
  selectedLuceneMajor?: number;
  fields: FieldSummary[];
  columns: TableColumn[];
  rows: DocumentRow[];
  page: PageState;
  total: string;
  error?: string;
}
```

Webview 只根据 `LensPageState` 渲染，不自行访问文件系统或启动 CLI。

`probe` 返回的数据至少包含：

```ts
interface ProbeResult {
  detectedLuceneMajor: number;
  pluginLuceneMajor: number;
  compatible: boolean;
}
```

#### 2.4.6 CLI 响应

```ts
interface CliError {
  code: string;
  message: string;
  retryable: boolean;
}

type CliResponse<T> =
  | {
      protocolVersion: number;
      cliVersion: string;
      pluginVersion?: string;
      luceneVersion?: string;
      result: T;
    }
  | {
      protocolVersion: number;
      cliVersion: string;
      error: CliError;
    };
```

Extension Host 必须先校验响应结构和 `protocolVersion`，再把 `result` 转换为页面状态。

### 2.5 TypeScript 扩展架构

- `javaCommandRunner`：优先解析配置的 Java Home，未配置时使用系统 `PATH` 中的 `java`；以参数数组执行单次命令，收集 stdout/stderr，并处理版本校验、超时、取消、退出码和输出大小限制。
- `luceneVersionResolver`：发现已打包插件、执行 `probe`、识别数据版本并维护当前索引的插件选择。
- `indexDirectoryService`：扫描和维护工作区索引目录、版本匹配及页面缓存，不持有 Java reader 或进程。
- `protocol/validation`：校验来自 CLI 和 Webview 的所有消息。
- `views`：注册侧边栏入口和打开页面按钮，不承载索引数据。
- `webview`：只负责展示与交互，数据统一通过扩展进程转发。

版本选择流程：

1. 扫描 `dist/cli/plugins/lucene-<major>/`，建立可用插件列表。
2. 对候选索引执行 `probe --plugin <jar> --index <path>`，读取 `detectedLuceneMajor`。
3. 存在与数据主版本相同的插件时将其作为默认选项；否则选择第一个兼容插件。
4. 手动切换版本时先对目标插件执行 `probe`，成功后更新当前选择。
5. 权限或损坏错误立即停止探测；全部插件不兼容时返回版本检测失败。
6. 索引从扫描结果移除时清除其探测结果和手动选择。

### 2.6 查询

首版使用 Lucene Query Parser，并限制以下能力：

- `field:value` 形式按指定字段查询；未指定字段时，使用 `MultiFieldQueryParser` 查询当前索引全部文本索引字段。
- Analyzer 由 `luceneLens.query.analyzer` 配置，只提供 `StandardAnalyzer`、`KeywordAnalyzer` 和 `SmartChineseAnalyzer`。
- 不支持通过任意类名加载 Analyzer。
- 返回内部 doc ID、score 和表格当前展示的 stored fields、doc values。
- 使用 `searchAfter` 分页，避免一次保留全部命中。
- query cursor 只需包含恢复下一页所需的排序状态。
- 设置最大命中遍历量、超时和可取消任务。

### 2.7 性能与资源控制

- 默认页大小 50，CLI 硬上限建议 1000。
- term、文档和查询响应均使用 cursor，不使用不受控 offset 扫描。
- Webview 只渲染当前页；大量行可进一步使用虚拟列表。
- 每次 CLI 命令使用受控堆大小启动，默认建议 `-Xmx512m`。
- 每条命令只在执行期间持有 reader，并在退出前释放。
- 扩展可以缓存已返回的概览和页面，但不能持有 Java reader。
- 对连续快速筛选使用防抖；取消时终止对应的一次性子进程。
- 二进制 stored field 默认不传完整内容；仅在用户显式请求时读取，且有字节上限。
- 导出采用流式写入，避免在 Extension Host 中拼接完整结果。

### 2.8 安全

1. 只扫描当前工作区目录；工作区未受信任时不启动 Java CLI。
2. CLI 只接收规范化后的目录路径，并仅以只读方式打开。
3. 不调用 `IndexWriter`，不提供删除锁文件或自动修复功能。
4. Webview 使用 CSP、nonce 和 HTML 转义。
5. 不通过 shell 拼接 Java 命令；使用进程 API 的参数数组。
6. 默认离线运行，不上传索引信息。
7. 日志对路径和字段值采用最小披露原则。
8. 导出目标必须由用户确认，文件覆盖遵循 VS Code 的确认体验。

### 2.9 Java 运行时与打包

首版不随插件打包 Java Runtime，由用户环境提供 JDK：

1. 配置了 `luceneLens.java.home` 时，使用其 `bin/java`；Windows 使用 `bin/java.exe`。
2. 未配置时，尝试使用系统 `PATH` 中的 `java`。
3. 启动 CLI 前执行版本检查；Lucene 9 要求 Java 11 或更高版本。
4. 解析出的 Java 可用且版本符合要求时直接使用；无法解析或版本不符合要求时，停止操作并提示用户配置有效的 Java Home。

CLI core 和 Lucene 插件 jar 均不包含平台原生依赖，使用同一套产物支持 macOS、Windows 和 Linux。打包与运行还应满足：

- 在三个平台分别验证 Java 路径解析、参数传递、取消、超时和进程退出行为。
- CLI core 构建为单个可执行 jar；首版只构建一个包含 Lucene 9 运行依赖的插件 jar。
- 运行时通过扩展安装目录定位 `dist/cli`，不能依赖当前工作目录。

### 2.10 日志与错误处理

- 创建 `Lucene Lens` Output Channel。
- 每个请求生成 request ID，记录方法、耗时、结果条数和错误码。
- 默认不记录查询结果、stored field 值和完整 term。
- 用户提示采用“问题 + 建议动作”格式，例如：
  - `This directory is not a Lucene index. Choose a directory containing segments_N.`
  - `The index was created by an unsupported Lucene version. Select a compatible CLI.`
- 提供 `Show Logs` 操作查看详细堆栈，但 UI 提示不直接暴露内部异常。

### 2.11 实施顺序

#### 2.11.1 工程骨架

- 初始化 VS Code Extension TypeScript 工程
- 初始化 Java CLI Maven 多模块构建
- 建立 `cli-core`、插件 SPI、版本化插件和 `probe` 命令
- 建立子命令、JSON 输出模型和 Output Channel
- 完成单次命令执行、超时、取消与资源释放

验收：扩展可执行 `version` 和 `probe` 命令、为 core 选择对应版本插件、解析 JSON 和退出码；命令结束后不存在常驻 Java 进程。

#### 2.11.2 只读打开与概览

- 侧边栏入口按钮和单例 Webview 页面
- 工作区 `segments_*` 扫描、候选目录去重和 `probe`
- 索引下拉、版本下拉、字段加载和第一页文档
- 顶部搜索框、表格、页脚分页和页面状态

验收：点击侧边栏按钮可打开页面，自动发现工作区索引，选择索引后展示第一页数据并可搜索和翻页。

#### 2.11.3 字段能力

- 字段能力聚合

验收：能够读取查询和文档展示所需的字段能力，不阻塞 Extension Host。

#### 2.11.4 文档与查询

- stored fields 与 doc values 分页
- stored fields 与 doc values 详情展示
- 文档详情
- 支持 Standard、Keyword 和 Smart Chinese Analyzer 的受限 Query Parser
- `searchAfter` 查询分页、超时和取消

验收：可以查询并查看命中文档；关闭页面或修改查询时可取消旧请求。

#### 2.11.5 导出与发布

- 流式 CSV 导出
- 配置、图标、README、CHANGELOG 和插件商店信息
- 多平台打包验证
- 补充安全、性能和兼容性说明

验收：生成可安装 VSIX，并在目标平台完成基本使用验证。

### 2.12 验证

遵循项目规则，默认不新增或修改测试用例，除非用户明确要求。实现过程中仍需进行与变更相称的验证：

- TypeScript 类型检查和 lint
- Java 编译与静态检查
- 使用临时生成的小型索引做手工冒烟验证
- 使用包含删除文档、二进制字段、doc values、无 stored field 和多 segment 的 Lucene 9 索引验证边界
- 使用中文字段验证 Smart Chinese Analyzer 查询
- 使用较大索引验证分页、取消、超时和内存限制
- 在 macOS、Windows、Linux 验证 Java 探测、参数传递、超时终止和进程退出

如后续用户明确要求自动化测试，优先覆盖 CLI 参数解析、JSON 输出、分页边界、资源释放和错误映射。

### 2.13 技术约束

1. 首版只支持 Lucene 9，只打包 `cli-plugin-lucene-9`；版本探测只需验证 Lucene 9 插件。
2. 首版同时支持 macOS、Windows 和 Linux，不引入平台原生依赖。
3. JDK 由用户环境提供。优先使用 `luceneLens.java.home`，未配置时使用系统 `PATH` 中的 `java`；解析出的 Java 可用且版本符合要求时直接使用，否则提示用户配置 Java Home。
4. 查询支持中文 Analyzer，内置 `SmartChineseAnalyzer`，配置值为 `smartcn`。
5. 文档列表、详情和查询结果同时展示 stored fields 与 doc values。
6. 导出格式仅支持 CSV。
