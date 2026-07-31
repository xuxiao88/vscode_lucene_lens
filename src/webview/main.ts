import type {
  DocumentRow,
  FieldType,
  HostMessage,
  LensPageState
} from "../protocol/types";

declare function acquireVsCodeApi<T = unknown>(): {
  postMessage(message: unknown): void;
  getState(): T | undefined;
  setState(state: T): void;
};

const vscode = acquireVsCodeApi<LensPageState>();
const elements = {
  version: byId<HTMLSelectElement>("versionSelect"),
  exactAnalyzer: byId<HTMLSelectElement>("exactAnalyzerSelect"),
  fullTextAnalyzer: byId<HTMLSelectElement>("fullTextAnalyzerSelect"),
  exactFieldCount: byId<HTMLElement>("exactFieldCount"),
  fullTextFieldCount: byId<HTMLElement>("fullTextFieldCount"),
  exactFieldExamples: byId<HTMLElement>("exactFieldExamples"),
  fullTextFieldExamples: byId<HTMLElement>("fullTextFieldExamples"),
  addFieldAnalyzer: byId<HTMLButtonElement>("addFieldAnalyzerButton"),
  fieldAnalyzers: byId<HTMLElement>("fieldAnalyzerList"),
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

let addingFieldAnalyzer = false;
let state: LensPageState | undefined = vscode.getState();
if (state
    && Array.isArray(state.analyzers)
    && Array.isArray(state.searchableFields)
    && state.inferredFieldTypes
    && typeof state.inferredFieldTypes === "object"
    && state.fieldTypes
    && typeof state.fieldTypes === "object"
    && state.fieldTypeOverrides
    && typeof state.fieldTypeOverrides === "object"
    && state.fieldTypeAnalyzers
    && typeof state.fieldTypeAnalyzers === "object"
    && state.fieldAnalyzers
    && typeof state.fieldAnalyzers === "object") {
  render(state);
} else {
  state = undefined;
}

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
    query: elements.search.value
  });
});
elements.querySettings.addEventListener("click", () => {
  const expanded = elements.querySettings.getAttribute("aria-expanded") === "true";
  elements.querySettings.setAttribute("aria-expanded", String(!expanded));
  elements.querySettingsPanel.hidden = expanded;
});
elements.exactAnalyzer.addEventListener("change", () =>
  setFieldTypeAnalyzer("exact", elements.exactAnalyzer.value)
);
elements.fullTextAnalyzer.addEventListener("change", () =>
  setFieldTypeAnalyzer("fullText", elements.fullTextAnalyzer.value)
);
elements.addFieldAnalyzer.addEventListener("click", () => {
  if (!state) return;
  addingFieldAnalyzer = true;
  renderFieldAnalyzers(state);
});
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
  renderFieldTypeRules(next);
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
  renderFieldAnalyzers(next);
  renderTable(next.rows);
}

function renderFieldTypeRules(next: LensPageState): void {
  for (const [select, fieldType] of [
    [elements.exactAnalyzer, "exact"],
    [elements.fullTextAnalyzer, "fullText"]
  ] as Array<[HTMLSelectElement, FieldType]>) {
    select.replaceChildren(
      ...next.analyzers.map((analyzer) => analyzerOption(analyzer.name, analyzer.label))
    );
    select.value = next.fieldTypeAnalyzers[fieldType];
    select.disabled =
      !next.selectedIndexId || next.status === "scanning" || next.analyzers.length === 0;
  }
  const exactFields = fieldsOfType(next, "exact");
  const fullTextFields = fieldsOfType(next, "fullText");
  elements.exactFieldCount.textContent =
    `${exactFields.length} fields · DOCS by default`;
  elements.fullTextFieldCount.textContent =
    `${fullTextFields.length} fields · frequencies / positions by default`;
  renderFieldTypeFields(elements.exactFieldExamples, next, "exact", exactFields);
  renderFieldTypeFields(elements.fullTextFieldExamples, next, "fullText", fullTextFields);
}

function renderFieldAnalyzers(next: LensPageState): void {
  elements.fieldAnalyzers.replaceChildren();
  const configuredFields = Object.keys(next.fieldAnalyzers)
    .filter((field) => next.searchableFields.includes(field))
    .sort((left, right) => left.localeCompare(right));
  const availableFields = next.searchableFields
    .filter((field) => !Object.prototype.hasOwnProperty.call(next.fieldAnalyzers, field));
  elements.addFieldAnalyzer.disabled =
    !next.selectedIndexId
    || next.status === "scanning"
    || addingFieldAnalyzer
    || availableFields.length === 0;
  if (next.searchableFields.length === 0) {
    const empty = document.createElement("span");
    empty.className = "field-analyzers-empty";
    empty.textContent = next.selectedIndexId
      ? "This index has no searchable fields."
      : "Open an index to configure field analyzers.";
    elements.fieldAnalyzers.append(empty);
    return;
  }
  if (configuredFields.length === 0 && !addingFieldAnalyzer) {
    const empty = document.createElement("span");
    empty.className = "field-analyzers-empty";
    empty.textContent = "No field rules. All fields currently use their inferred type rule.";
    elements.fieldAnalyzers.append(empty);
  }
  for (const field of configuredFields) {
    const row = document.createElement("div");
    row.className = "field-analyzer";
    const name = document.createElement("span");
    name.className = "field-analyzer-field";
    const fieldName = document.createElement("strong");
    fieldName.textContent = field;
    const fieldType = document.createElement("small");
    const effectiveFieldType = next.fieldTypes[field] ?? "fullText";
    fieldType.textContent = Object.prototype.hasOwnProperty.call(next.fieldTypeOverrides, field)
      ? `${fieldTypeLabel(effectiveFieldType)} · Field type override`
      : fieldTypeLabel(effectiveFieldType);
    name.append(fieldName, fieldType);
    name.title = field;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Analyzer for ${field}`);
    for (const analyzer of next.analyzers) {
      select.append(analyzerOption(analyzer.name, analyzer.label));
    }
    select.value = next.fieldAnalyzers[field]
      ?? next.fieldTypeAnalyzers[next.fieldTypes[field] ?? "fullText"];
    select.disabled = next.status === "scanning";
    select.addEventListener("change", () =>
      vscode.postMessage({
        type: "setFieldAnalyzer",
        field,
        analyzer: select.value
      })
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "field-analyzer-remove";
    remove.textContent = "Reset to type rule";
    remove.title = `Reset ${field} to its inferred field type rule`;
    remove.setAttribute("aria-label", `Reset ${field} to its inferred field type rule`);
    remove.disabled = next.status === "scanning";
    remove.addEventListener("click", () =>
      vscode.postMessage({type: "removeFieldAnalyzer", field})
    );
    const source = document.createElement("span");
    source.className = "field-analyzer-source";
    source.textContent = "Field rule";
    row.append(name, select, source, remove);
    elements.fieldAnalyzers.append(row);
  }
  if (addingFieldAnalyzer && availableFields.length > 0) {
    elements.fieldAnalyzers.append(createFieldAnalyzerEditor(availableFields, next));
  } else {
    addingFieldAnalyzer = false;
  }
}

function createFieldAnalyzerEditor(
  availableFields: string[],
  next: LensPageState
): HTMLElement {
  const row = document.createElement("div");
  row.className = "field-analyzer field-analyzer-editor";
  const fieldSelect = document.createElement("select");
  fieldSelect.setAttribute("aria-label", "Field");
  const placeholder = analyzerOption("", "Select field");
  placeholder.disabled = true;
  placeholder.selected = true;
  fieldSelect.append(placeholder);
  for (const field of availableFields) {
    const type = next.fieldTypes[field] ?? "fullText";
    fieldSelect.append(analyzerOption(field, `${field} · ${fieldTypeLabel(type)}`));
  }
  const analyzerSelect = document.createElement("select");
  analyzerSelect.setAttribute("aria-label", "Analyzer");
  for (const analyzer of next.analyzers) {
    analyzerSelect.append(analyzerOption(analyzer.name, analyzer.label));
  }
  const actions = document.createElement("span");
  actions.className = "field-analyzer-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Add";
  save.disabled = true;
  fieldSelect.addEventListener("change", () => {
    save.disabled = fieldSelect.value === "";
    const fieldType = next.fieldTypes[fieldSelect.value] ?? "fullText";
    analyzerSelect.value = next.fieldTypeAnalyzers[fieldType];
  });
  save.addEventListener("click", () => {
    if (!fieldSelect.value) return;
    addingFieldAnalyzer = false;
    vscode.postMessage({
      type: "setFieldAnalyzer",
      field: fieldSelect.value,
      analyzer: analyzerSelect.value
    });
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    addingFieldAnalyzer = false;
    if (state) renderFieldAnalyzers(state);
  });
  actions.append(save, cancel);
  row.append(fieldSelect, analyzerSelect, actions);
  return row;
}

function setFieldTypeAnalyzer(fieldType: FieldType, analyzer: string): void {
  vscode.postMessage({type: "setFieldTypeAnalyzer", fieldType, analyzer});
}

function fieldsOfType(next: LensPageState, fieldType: FieldType): string[] {
  return next.searchableFields.filter((field) => next.fieldTypes[field] === fieldType);
}

function renderFieldTypeFields(
  container: HTMLElement,
  next: LensPageState,
  currentType: FieldType,
  fields: string[]
): void {
  container.replaceChildren();
  if (fields.length === 0) {
    const empty = document.createElement("span");
    empty.textContent = "No fields";
    container.append(empty);
    return;
  }
  for (const field of fields) {
    const targetType: FieldType = currentType === "exact" ? "fullText" : "exact";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "field-type-field";
    const overridden = Object.prototype.hasOwnProperty.call(next.fieldTypeOverrides, field);
    button.classList.toggle("overridden", overridden);
    button.disabled = next.status === "scanning";
    button.title = `${overridden ? "Manually classified. " : ""}Move ${field} to ${fieldTypeLabel(targetType)}.`;
    button.setAttribute(
      "aria-label",
      `${overridden ? "Manually classified. " : ""}Move ${field} to ${fieldTypeLabel(targetType)}`
    );
    const label = document.createElement("span");
    label.textContent = field;
    const action = document.createElement("span");
    action.className = "field-type-field-action";
    action.textContent = "↔";
    button.append(label, action);
    if (overridden) {
      const manual = document.createElement("small");
      manual.textContent = "Manual";
      button.append(manual);
    }
    button.addEventListener("click", () =>
      vscode.postMessage({type: "setFieldType", field, fieldType: targetType})
    );
    container.append(button);
  }
}

function fieldTypeLabel(fieldType: FieldType): string {
  return fieldType === "exact" ? "Exact value" : "Full text";
}

function analyzerOption(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
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
