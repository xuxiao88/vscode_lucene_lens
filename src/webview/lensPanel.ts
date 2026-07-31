import {randomBytes} from "node:crypto";
import * as vscode from "vscode";
import {CliError, JavaCommandRunner} from "../platform/javaCommandRunner";
import {
  parseDocumentPage,
  parseDocumentRow,
  parseFieldSummaries,
  parseWebviewMessage
} from "../protocol/validation";
import type {
  AnalyzerName,
  DocumentRow,
  FieldAnalyzerSelection,
  HostMessage,
  LensPageState,
  PageResult,
  ResolvedIndex,
  WebviewMessage
} from "../protocol/types";
import {IndexDirectoryService} from "../services/indexDirectoryService";

export class LensPanel implements vscode.Disposable {
  private static current: LensPanel | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    runner: JavaCommandRunner,
    indexes: IndexDirectoryService,
    output: vscode.OutputChannel
  ): LensPanel {
    if (LensPanel.current) {
      LensPanel.current.panel.reveal(vscode.ViewColumn.One);
      return LensPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "luceneLens",
      "Lucene Lens",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
          vscode.Uri.joinPath(context.extensionUri, "media")
        ]
      }
    );
    LensPanel.current = new LensPanel(panel, context, runner, indexes, output);
    return LensPanel.current;
  }

  static getCurrent(): LensPanel | undefined {
    return LensPanel.current;
  }

  private readonly disposables: vscode.Disposable[] = [];
  private cancellation: vscode.CancellationTokenSource | undefined;
  private resolvedIndexes: ResolvedIndex[] = [];
  private cursors: Array<string | undefined> = [undefined];
  private webviewReady = false;
  private preferredIndexId: string | undefined;
  private readonly analyzerSettings = new Map<string, AnalyzerSettings>();
  private readonly searchableFieldCache = new Map<string, string[]>();
  private state: LensPageState;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly runner: JavaCommandRunner,
    private readonly indexService: IndexDirectoryService,
    private readonly output: vscode.OutputChannel
  ) {
    const configuredPageSize = vscode.workspace
      .getConfiguration("luceneLens")
      .get<number>("pageSize", 50);
    this.state = {
      status: "loading",
      rows: [],
      pageNumber: 1,
      pageSize: normalizePageSize(configuredPageSize),
      total: "0",
      totalRelation: "exact",
      query: "",
      analyzer: this.configuredAnalyzer(),
      searchableFields: [],
      fieldAnalyzers: {},
      hasPrevious: false,
      hasNext: false
    };
    this.panel.webview.html = this.html(context);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((raw) => {
        const message = parseWebviewMessage(raw);
        if (message) void this.handleMessage(message);
      })
    );
  }

  dispose(): void {
    this.cancelCurrent();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    LensPanel.current = undefined;
  }

  async openIndex(indexId: string): Promise<void> {
    this.preferredIndexId = indexId;
    this.panel.reveal(vscode.ViewColumn.One);
    if (!this.webviewReady) return;
    const cached = this.indexService.getCached();
    if (cached.some((index) => index.id === indexId)) {
      await this.applyIndexes(cached, indexId);
      return;
    }
    await this.rescan(indexId);
  }

  async rescan(preferredIndexId = this.preferredIndexId): Promise<void> {
    this.cancelCurrent();
    if (!vscode.workspace.isTrusted) {
      this.resolvedIndexes = [];
      this.cursors = [undefined];
      this.update({
        status: "untrusted",
        selectedIndexId: undefined,
        rows: [],
        searchableFields: [],
        fieldAnalyzers: {},
        error: "Trust this workspace before Lucene Lens scans or opens indexes."
      });
      return;
    }
    const token = this.startOperation();
    this.update({
      status: "scanning",
      error: undefined,
      selectedIndexId: undefined,
      selectedLuceneMajor: undefined,
      rows: [],
      searchableFields: [],
      fieldAnalyzers: {},
      total: "0",
      hasPrevious: false,
      hasNext: false
    });
    try {
      const indexes = await this.indexService.scan(token);
      await this.applyIndexes(indexes, preferredIndexId);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.endOperation(token);
    }
  }

  async exportCurrent(): Promise<void> {
    const index = this.selectedIndex();
    if (!index) {
      void vscode.window.showInformationMessage("Open a Lucene index before exporting.");
      return;
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? this.context.extensionUri,
        "lucene-export.csv"
      ),
      filters: {"CSV": ["csv"]},
      saveLabel: "Export Lucene CSV"
    });
    if (!target) return;
    const config = vscode.workspace.getConfiguration("luceneLens");
    const maxHits = config.get<number>("query.maxHits", 10000);
    const args = [
      "--index", index.absolutePath,
      "--target", target.fsPath,
      "--query", this.state.query,
      ...this.analyzerArgs(),
      "--max-hits", String(maxHits)
    ];
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Exporting Lucene documents",
          cancellable: true
        },
        async (_progress, token) =>
          this.runner.run<{exported: string}>("export", args, token, 30 * 60 * 1000)
      );
      this.post({type: "notice", message: `Exported ${result.exported} documents to ${target.fsPath}`});
    } catch (error) {
      this.handleError(error, false);
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
          this.webviewReady = true;
          if (this.indexService.getCached().length > 0) {
            await this.applyIndexes(this.indexService.getCached(), this.preferredIndexId);
          } else {
            await this.rescan(this.preferredIndexId);
          }
          break;
        case "rescan":
          await this.rescan(this.state.selectedIndexId);
          break;
        case "search":
          await this.search(message.query);
          break;
        case "setAnalyzer":
          await this.setAnalyzer(message.analyzer);
          break;
        case "setFieldAnalyzer":
          await this.setFieldAnalyzer(message.field, message.analyzer);
          break;
        case "pageSize":
          this.cursors = [undefined];
          this.update({pageSize: message.pageSize, pageNumber: 1});
          await this.loadPage();
          break;
        case "previousPage":
          if (this.state.pageNumber > 1) {
            this.update({pageNumber: this.state.pageNumber - 1});
            await this.loadPage();
          }
          break;
        case "nextPage":
          if (this.state.hasNext) {
            this.update({pageNumber: this.state.pageNumber + 1});
            await this.loadPage();
          }
          break;
        case "document":
          await this.loadDocument(message.docId);
          break;
        case "export":
          await this.exportCurrent();
          break;
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private async applyIndexes(
    indexes: ResolvedIndex[],
    preferredIndexId?: string
  ): Promise<void> {
    this.cancelCurrent();
    this.resolvedIndexes = indexes;
    if (indexes.length === 0) {
      this.preferredIndexId = undefined;
      this.cursors = [undefined];
      this.update({
        status: "empty",
        selectedIndexId: undefined,
        selectedLuceneMajor: undefined,
        rows: [],
        searchableFields: [],
        fieldAnalyzers: {},
        total: "0",
        hasPrevious: false,
        hasNext: false
      });
      return;
    }
    const selectedIndexId = indexes.some((index) => index.id === preferredIndexId)
      ? preferredIndexId
      : indexes[0]?.id;
    this.preferredIndexId = selectedIndexId;
    const settings = selectedIndexId
      ? this.analyzerSettings.get(selectedIndexId)
      : undefined;
    this.cursors = [undefined];
    this.update({
      selectedIndexId,
      selectedLuceneMajor: 9,
      query: "",
      analyzer: settings?.analyzer ?? this.configuredAnalyzer(),
      searchableFields: [],
      fieldAnalyzers: {},
      pageNumber: 1,
      rows: [],
      total: "0",
      hasPrevious: false,
      hasNext: false
    });
    await this.loadSearchableFields();
    await this.loadPage();
  }

  private async search(query: string): Promise<void> {
    this.cancelCurrent();
    this.cursors = [undefined];
    this.update({query: query.trim(), pageNumber: 1});
    await this.loadPage();
  }

  private async setAnalyzer(analyzer: AnalyzerName): Promise<void> {
    if (this.state.analyzer === analyzer) return;
    this.cancelCurrent();
    this.cursors = [undefined];
    this.update({analyzer, pageNumber: 1});
    this.saveAnalyzerSettings();
    if (this.state.query) await this.loadPage();
  }

  private async setFieldAnalyzer(
    field: string,
    analyzer: FieldAnalyzerSelection
  ): Promise<void> {
    if (!this.state.searchableFields.includes(field)
        || this.state.fieldAnalyzers[field] === analyzer) {
      return;
    }
    this.cancelCurrent();
    this.cursors = [undefined];
    this.update({
      fieldAnalyzers: {...this.state.fieldAnalyzers, [field]: analyzer},
      pageNumber: 1
    });
    this.saveAnalyzerSettings();
    if (this.state.query) await this.loadPage();
  }

  private async loadSearchableFields(): Promise<void> {
    const index = this.selectedIndex();
    if (!index) return;
    let searchableFields = this.searchableFieldCache.get(index.id);
    if (!searchableFields) {
      const fields = parseFieldSummaries(await this.runner.run<unknown>(
        "fields",
        ["--index", index.absolutePath]
      ));
      searchableFields = fields
        .filter((field) => field.indexed)
        .map((field) => field.name)
        .sort((left, right) => left.localeCompare(right));
      this.searchableFieldCache.set(index.id, searchableFields);
    }
    const saved = this.analyzerSettings.get(index.id);
    const fieldAnalyzers = Object.fromEntries(
      searchableFields.map((field) => [
        field,
        saved?.fieldAnalyzers[field] ?? "inherit"
      ])
    ) as Record<string, FieldAnalyzerSelection>;
    this.update({
      searchableFields,
      analyzer: saved?.analyzer ?? this.state.analyzer,
      fieldAnalyzers
    });
    this.saveAnalyzerSettings();
  }

  private async loadPage(): Promise<void> {
    const index = this.selectedIndex();
    if (!index) return;
    this.cancelCurrent();
    const token = this.startOperation();
    this.update({status: "loading", error: undefined});
    try {
      const cursor = this.cursors[this.state.pageNumber - 1] ?? "";
      const config = vscode.workspace.getConfiguration("luceneLens");
      let result: PageResult<DocumentRow>;
      if (this.state.query) {
        result = parseDocumentPage(await this.runner.run<unknown>(
          "query",
          [
            "--index", index.absolutePath,
            "--query", this.state.query,
            ...this.analyzerArgs(),
            "--cursor", cursor,
            "--limit", String(this.state.pageSize),
            "--max-hits", String(config.get<number>("query.maxHits", 10000))
          ],
          token
        ));
      } else {
        result = parseDocumentPage(await this.runner.run<unknown>(
          "documents",
          [
            "--index", index.absolutePath,
            "--cursor", cursor || "0",
            "--limit", String(this.state.pageSize)
          ],
          token
        ));
      }
      if (result.nextCursor) this.cursors[this.state.pageNumber] = result.nextCursor;
      this.update({
        status: "ready",
        rows: result.items,
        total: result.total,
        totalRelation: result.totalRelation,
        hasPrevious: this.state.pageNumber > 1,
        hasNext: result.hasMore
      });
    } finally {
      this.endOperation(token);
    }
  }

  private async loadDocument(docId: number): Promise<void> {
    const index = this.selectedIndex();
    if (!index) return;
    const document = parseDocumentRow(await this.runner.run<unknown>("document", [
      "--index", index.absolutePath,
      "--doc-id", String(docId),
      "--include-binary", "true"
    ]));
    this.post({type: "document", document});
  }

  private selectedIndex(): ResolvedIndex | undefined {
    return this.resolvedIndexes.find((item) => item.id === this.state.selectedIndexId);
  }

  private analyzerArgs(): string[] {
    const result = ["--analyzer", this.state.analyzer];
    for (const field of this.state.searchableFields) {
      const analyzer = this.state.fieldAnalyzers[field];
      if (analyzer && analyzer !== "inherit") {
        result.push("--field-analyzer", field, analyzer);
      }
    }
    return result;
  }

  private saveAnalyzerSettings(): void {
    const indexId = this.state.selectedIndexId;
    if (!indexId) return;
    this.analyzerSettings.set(indexId, {
      analyzer: this.state.analyzer,
      fieldAnalyzers: {...this.state.fieldAnalyzers}
    });
  }

  private configuredAnalyzer(): AnalyzerName {
    const value = vscode.workspace
      .getConfiguration("luceneLens")
      .get<string>("query.analyzer", "standard");
    if (value === "standard"
        || value === "keyword"
        || value === "whitespace"
        || value === "simple"
        || value === "cjk"
        || value === "smartcn") {
      return value;
    }
    this.output.appendLine(`Unsupported analyzer configuration '${value}', falling back to standard.`);
    return "standard";
  }

  private startOperation(): vscode.CancellationToken {
    this.cancellation = new vscode.CancellationTokenSource();
    return this.cancellation.token;
  }

  private endOperation(token: vscode.CancellationToken): void {
    if (this.cancellation?.token === token) {
      this.cancellation.dispose();
      this.cancellation = undefined;
    }
  }

  private cancelCurrent(): void {
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.cancellation = undefined;
  }

  private handleError(error: unknown, updateState = true): void {
    const cliError = error instanceof CliError ? error : undefined;
    if (cliError?.code === "REQUEST_CANCELLED") {
      if (updateState && !this.cancellation) this.update({status: "cancelled"});
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`UI operation failed: ${message}`);
    if (updateState) this.update({status: "error", error: message});
    else if (!cliError?.code.startsWith("JAVA_")) void vscode.window.showErrorMessage(message);
    if (cliError?.code.startsWith("JAVA_")) {
      void vscode.window
        .showErrorMessage(message, "Open Java Home Setting")
        .then((choice) => {
          if (choice) {
            void vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "luceneLens.java.home"
            );
          }
        });
    }
  }

  private update(changes: Partial<LensPageState>): void {
    this.state = {...this.state, ...changes};
    this.post({type: "state", state: this.state});
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private html(context: vscode.ExtensionContext): string {
    const nonce = randomBytes(16).toString("base64");
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.js")
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "lucene-lens.css")
    );
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>Lucene Lens</title>
</head>
<body>
  <main class="app">
    <header class="toolbar">
      <select id="versionSelect" aria-label="Lucene version"><option>Lucene 9</option></select>
      <form id="searchForm" class="search">
        <input id="searchInput" type="search" placeholder="Search current index" aria-label="Search query">
        <button type="submit" title="Search">Search</button>
      </form>
      <button id="querySettingsButton"
              aria-expanded="false"
              aria-controls="querySettingsPanel"
              title="Query settings">Query Settings</button>
      <button id="rescanButton" title="Rescan workspace">Rescan</button>
      <button id="exportButton" title="Export CSV">Export CSV</button>
    </header>
    <section id="querySettingsPanel" class="query-settings" hidden>
      <div class="query-settings-default">
        <label>Default analyzer
          <select id="analyzerSelect">
            <option value="standard">Standard</option>
            <option value="keyword">Keyword</option>
            <option value="whitespace">Whitespace</option>
            <option value="simple">Simple</option>
            <option value="cjk">CJK</option>
            <option value="smartcn">Smart Chinese</option>
          </select>
        </label>
        <span>Used by fields that inherit the default.</span>
      </div>
      <div class="field-analyzers-section">
        <strong>Field analyzers</strong>
        <span>Override the default for individual searchable fields.</span>
        <div id="fieldAnalyzerList" class="field-analyzers"></div>
      </div>
    </section>
    <section id="status" class="status" aria-live="polite"></section>
    <section class="table-wrap">
      <table>
        <thead id="tableHead"></thead>
        <tbody id="tableBody"></tbody>
      </table>
    </section>
    <footer class="pager">
      <span id="total"></span>
      <label>Rows
        <select id="pageSize">
          <option value="25">25</option><option value="50">50</option>
          <option value="100">100</option><option value="200">200</option>
        </select>
      </label>
      <button id="previousButton">Previous</button>
      <span id="pageNumber"></span>
      <button id="nextButton">Next</button>
    </footer>
  </main>
  <dialog id="detailDialog">
    <header><strong>Document details</strong><button id="closeDetail" aria-label="Close">×</button></header>
    <pre id="detailContent"></pre>
  </dialog>
  <div id="toast" role="status"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

interface AnalyzerSettings {
  analyzer: AnalyzerName;
  fieldAnalyzers: Record<string, FieldAnalyzerSelection>;
}

function normalizePageSize(value: number): 25 | 50 | 100 | 200 {
  return [25, 50, 100, 200].includes(value) ? (value as 25 | 50 | 100 | 200) : 50;
}
