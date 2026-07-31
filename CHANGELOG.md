# 变更记录

## 0.1.0

- 支持自动发现工作区中的 Lucene 9 索引。
- 支持通过 backward codecs 读取较早 Lucene 9.x 默认格式的索引。
- 支持在侧边栏列出、刷新、手动添加并直接打开 Lucene 索引。
- 支持通过 cursor 分页浏览 stored fields 和 DocValues。
- 支持在查询设置中配置默认 Analyzer，并按字段继承或覆盖 Standard、Keyword、Whitespace、Simple、CJK 和 Smart Chinese Analyzer。
- 支持文档详情和流式 CSV 导出。
- 支持通过 Java Home 或 `PATH` 启动一次性 Java CLI。
