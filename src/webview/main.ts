import type {DocumentRow, HostMessage, LensPageState} from "../protocol/types";

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: unknown): void;
  getState(): T | undefined;
  setState(state: T): void;
};

const vscode = acquireVsCodeApi<LensPageState>();
const elements = {
  version: byId<HTMLSelectElement>("versionSelect"),
  analyzer: byId<HTMLSelectElement>("analyzerSelect"),
  querySettings: byId<HTMLButtonElement>("querySettingsButton"),
  querySettingsPanel: byId<HTMLElement>("querySettingsPanel"),
  searchForm: byId<HTMLFormElement>("searchForm"),
  search: byId<HTMLInputElement>("searchInput"),
  rescan: byId<HTMLButtonElement>("rescanButton"),
  export: byId<HTMLButtonElement>("exportButton"),
  status: byId<HTMLElement>("status"),
  head: byId<HTMLTableSectionElement>("tableHead"),
  body: byId<HTMLTableSectionElement>("tableBody"),
  total: byId<HTMLElement>("total"),
  pageSize: byId<HTMLSelectElement>("pageSize"),
  previous: byId<HTMLButtonElement>("previousButton"),
  next: byId<HTMLButtonElement>("nextButton"),
  pageNumber: byId<HTMLElement>("pageNumber"),
  dialog: byId<HTMLDialogElement>("detailDialog"),
  detail: byId<HTMLElement>("detailContent"),
  closeDetail: byId<HTMLButtonElement>("closeDetail"),
  toast: byId<HTMLElement>("toast")
};

let state: LensPageState | undefined = vscode.getState();
if (state) render(state);

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "state") {
    state = message.state;
    vscode.setState(state);
    render(state);
  } else if (message.type === "document") {
    showDocument(message.document);
  } else if (message.type === "notice") {
    showToast(message.message);
  }
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  vscode.postMessage({
    type: "search",
    query: elements.search.value,
    analyzer: elements.analyzer.value
  });
});
elements.querySettings.addEventListener("click", () => {
  const expanded = elements.querySettings.getAttribute("aria-expanded") === "true";
  elements.querySettings.setAttribute("aria-expanded", String(!expanded));
  elements.querySettingsPanel.hidden = expanded;
});
elements.analyzer.addEventListener("change", () =>
  vscode.postMessage({type: "setAnalyzer", analyzer: elements.analyzer.value})
);
elements.rescan.addEventListener("click", () => vscode.postMessage({type: "rescan"}));
elements.export.addEventListener("click", () => vscode.postMessage({type: "export"}));
elements.pageSize.addEventListener("change", () =>
  vscode.postMessage({type: "pageSize", pageSize: Number(elements.pageSize.value)})
);
elements.previous.addEventListener("click", () => vscode.postMessage({type: "previousPage"}));
elements.next.addEventListener("click", () => vscode.postMessage({type: "nextPage"}));
elements.closeDetail.addEventListener("click", () => elements.dialog.close());

vscode.postMessage({type: "ready"});

function render(next: LensPageState): void {
  elements.search.value = next.query;
  elements.analyzer.value = next.analyzer;
  elements.pageSize.value = String(next.pageSize);
  elements.pageNumber.textContent = `Page ${next.pageNumber}`;
  elements.total.textContent =
    next.totalRelation === "lowerBound" ? `At least ${next.total} documents` : `${next.total} documents`;
  elements.previous.disabled = !next.hasPrevious || next.status === "loading";
  elements.next.disabled = !next.hasNext || next.status === "loading";
  elements.search.disabled = !next.selectedIndexId || next.status === "scanning";
  elements.export.disabled = !next.selectedIndexId || next.status === "scanning";
  elements.version.disabled = true;
  elements.status.textContent = statusText(next);
  elements.status.classList.toggle("error", next.status === "error");
  renderTable(next.rows);
}

function renderTable(rows: DocumentRow[]): void {
  elements.head.replaceChildren();
  elements.body.replaceChildren();
  const columns = collectColumns(rows);
  const headerRow = document.createElement("tr");
  for (const label of ["doc ID", ...(rows.some((row) => row.score !== undefined) ? ["score"] : []), ...columns.map((column) => column.label)]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.append(cell);
  }
  elements.head.append(headerRow);

  for (const row of rows) {
    const tableRow = document.createElement("tr");
    tableRow.tabIndex = 0;
    tableRow.title = "Open document details";
    tableRow.addEventListener("click", () => vscode.postMessage({type: "document", docId: row.docId}));
    tableRow.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        vscode.postMessage({type: "document", docId: row.docId});
      }
    });
    appendCell(tableRow, String(row.docId));
    if (rows.some((item) => item.score !== undefined)) appendCell(tableRow, formatScore(row.score));
    for (const column of columns) {
      const value =
        column.source === "stored"
          ? row.storedFields[column.field]
          : row.docValues[column.field];
      appendCell(tableRow, formatValue(value));
    }
    elements.body.append(tableRow);
  }
}

function collectColumns(rows: DocumentRow[]): Array<{field: string; source: "stored" | "docValues"; label: string}> {
  const keys = new Set<string>();
  const result: Array<{field: string; source: "stored" | "docValues"; label: string}> = [];
  for (const row of rows) {
    for (const field of Object.keys(row.storedFields)) add(field, "stored");
    for (const field of Object.keys(row.docValues)) add(field, "docValues");
  }
  return result;

  function add(field: string, source: "stored" | "docValues"): void {
    const key = `${source}:${field}`;
    if (keys.has(key)) return;
    keys.add(key);
    result.push({field, source, label: `${field} (${source})`});
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(formatValue).join(" · ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.values)) return record.values.map(formatValue).join(" · ");
    if (typeof record.value === "string") return record.value;
    if (typeof record.text === "string") return record.text;
    if (typeof record.byteLength === "number") return `[binary: ${record.byteLength} bytes]`;
  }
  return String(value);
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "" : score.toFixed(4);
}

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  cell.title = value;
  row.append(cell);
}

function showDocument(documentRow: DocumentRow): void {
  elements.detail.textContent = JSON.stringify(documentRow, null, 2);
  elements.dialog.showModal();
}

function statusText(next: LensPageState): string {
  switch (next.status) {
    case "untrusted": return next.error ?? "Workspace is not trusted.";
    case "scanning": return "Scanning for Lucene indexes…";
    case "empty": return "No Lucene 9 indexes found. Use the sidebar folder button to select one.";
    case "loading": return "Loading documents…";
    case "error": return next.error ?? "Unable to load the index.";
    case "cancelled": return "Operation cancelled.";
    default: return next.rows.length === 0 ? "No documents to display." : "";
  }
}

function showToast(message: string): void {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 5000);
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}
