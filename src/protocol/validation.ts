import type {
  CliResponse,
  AnalyzerName,
  DocumentRow,
  FieldAnalyzerSelection,
  FieldSummary,
  PageResult,
  ProbeResult,
  WebviewMessage
} from "./types";

export function parseCliResponse<T>(text: string): CliResponse<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("PROCESS_INVALID_JSON: CLI stdout is not valid JSON.");
  }
  if (!isRecord(value) || value.protocolVersion !== 1 || typeof value.cliVersion !== "string") {
    throw new Error("PROCESS_PROTOCOL_ERROR: CLI response has an unsupported shape.");
  }
  if (!("result" in value) && !isRecord(value.error)) {
    throw new Error("PROCESS_PROTOCOL_ERROR: CLI response contains neither result nor error.");
  }
  return value as CliResponse<T>;
}

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  switch (value.type) {
    case "ready":
    case "rescan":
    case "previousPage":
    case "nextPage":
    case "export":
      return {type: value.type};
    case "search":
      return typeof value.query === "string"
        ? {type: value.type, query: value.query}
        : undefined;
    case "setAnalyzer":
      return isAnalyzerName(value.analyzer)
        ? {type: value.type, analyzer: value.analyzer}
        : undefined;
    case "setFieldAnalyzer":
      return typeof value.field === "string" && isFieldAnalyzerSelection(value.analyzer)
        ? {type: value.type, field: value.field, analyzer: value.analyzer}
        : undefined;
    case "pageSize":
      return [25, 50, 100, 200].includes(Number(value.pageSize))
        ? {type: value.type, pageSize: Number(value.pageSize) as 25 | 50 | 100 | 200}
        : undefined;
    case "document":
      return Number.isInteger(value.docId) ? {type: value.type, docId: Number(value.docId)} : undefined;
    default:
      return undefined;
  }
}

function isAnalyzerName(value: unknown): value is AnalyzerName {
  return value === "standard"
    || value === "keyword"
    || value === "whitespace"
    || value === "simple"
    || value === "cjk"
    || value === "smartcn";
}

function isFieldAnalyzerSelection(value: unknown): value is FieldAnalyzerSelection {
  return value === "inherit" || isAnalyzerName(value);
}

export function parseFieldSummaries(value: unknown): FieldSummary[] {
  if (!isRecord(value)
      || !Array.isArray(value.items)
      || !value.items.every((item) =>
        isRecord(item) && typeof item.name === "string" && typeof item.indexed === "boolean")) {
    throw new Error("PROCESS_PROTOCOL_ERROR: Invalid fields result.");
  }
  return (value.items as Array<Record<string, unknown>>)
    .map((item) => ({name: item.name as string, indexed: item.indexed as boolean}));
}

export function parseProbeResult(value: unknown): ProbeResult {
  if (!isRecord(value)
      || !Number.isInteger(value.detectedLuceneMajor)
      || !Number.isInteger(value.pluginLuceneMajor)
      || typeof value.compatible !== "boolean") {
    throw new Error("PROCESS_PROTOCOL_ERROR: Invalid probe result.");
  }
  return value as unknown as ProbeResult;
}

export function parseDocumentRow(value: unknown): DocumentRow {
  if (!isRecord(value)
      || !Number.isInteger(value.docId)
      || !isRecord(value.storedFields)
      || !isRecord(value.docValues)
      || (value.score !== undefined && typeof value.score !== "number")) {
    throw new Error("PROCESS_PROTOCOL_ERROR: Invalid document result.");
  }
  return value as unknown as DocumentRow;
}

export function parseDocumentPage(value: unknown): PageResult<DocumentRow> {
  if (!isRecord(value)
      || !Array.isArray(value.items)
      || !value.items.every((item) => isDocumentRow(item))
      || typeof value.total !== "string"
      || (value.totalRelation !== "exact" && value.totalRelation !== "lowerBound")
      || typeof value.hasMore !== "boolean"
      || (value.nextCursor !== undefined
        && value.nextCursor !== null
        && typeof value.nextCursor !== "string")) {
    throw new Error("PROCESS_PROTOCOL_ERROR: Invalid document page result.");
  }
  return value as unknown as PageResult<DocumentRow>;
}

function isDocumentRow(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.docId)
    && isRecord(value.storedFields)
    && isRecord(value.docValues)
    && (value.score === undefined || typeof value.score === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
