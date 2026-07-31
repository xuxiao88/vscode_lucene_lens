# 变更记录

## 0.1.1

- Query Settings 根据索引元数据推断精确值字段和全文字段，并分别应用可见、可修改的 Analyzer 类型规则。
- 字段类型列表完整换行展示，支持将单个字段手工移动到另一类型并标识手工调整。
- 字段类型调整、类型 Analyzer 和优先级更高的字段 Analyzer 规则均按索引持久化，查询与 CSV 导出使用相同设置。

## 0.1.0

- 支持自动发现工作区中的 Lucene 9 索引。
- 支持通过 backward codecs 读取较早 Lucene 9.x 默认格式的索引。
- 支持在侧边栏列出、刷新、手动添加并直接打开 Lucene 索引。
- 手动添加的索引会持久化到工作区配置，并可从侧边栏安全移除引用而不删除索引文件。
- 支持通过 cursor 分页浏览 stored fields 和 DocValues。
- Analyzer 能力由对应 Lucene 版本插件声明，查询和导出只使用当前插件实际支持的 Analyzer。
- 支持配置默认 Analyzer，并按需添加字段级覆盖规则；配置持久化到工作区 `.vscode/lucene-lens.json`。
- Query Settings 使用紧凑的字段规则布局，多条规则自动横向排列和换行。
- 支持文档详情和流式 CSV 导出。
- 支持通过 Java Home 或 `PATH` 启动一次性 Java CLI。
