export type PageStatus =
  | "untrusted"
  | "scanning"
  | "empty"
  | "loading"
  | "ready"
  | "error"
  | "cancelled";

export type AnalyzerName = string;
export type FieldType = "exact" | "fullText";

export interface AnalyzerDefinition {
  name: AnalyzerName;
  label: string;
}

export interface PluginVersionResult {
  cliVersion: string;
  protocolVersion: number;
  javaVersion: string;
  pluginVersion: string;
  luceneVersion: string;
  analyzers: AnalyzerDefinition[];
}

export interface FieldSummary {
  name: string;
  indexed: boolean;
  indexOptions: string;
}

export interface AnalyzerSettings {
  analyzer: AnalyzerName;
  fieldTypeAnalyzers: Record<FieldType, AnalyzerName>;
  fieldTypeOverrides: Record<string, FieldType>;
  fieldAnalyzers: Record<string, AnalyzerName>;
}

export type StoredValue =
  | {type: "string"; value: string}
  | {type: "int" | "long" | "float" | "double"; value: string}
  | {type: "binary"; base64?: string; byteLength: number};

export interface BytesValue {
  text?: string;
  base64?: string;
  byteLength: number;
}

export type DocValue =
  | {type: "numeric" | "sortedNumeric"; values: string[]}
  | {type: "binary" | "sorted" | "sortedSet"; values: BytesValue[]};

export interface DocumentRow {
  docId: number;
  score?: number;
  storedFields: Record<string, StoredValue[]>;
  docValues: Record<string, DocValue>;
}

export interface PageResult<T> {
  items: T[];
  total: string;
  totalRelation: "exact" | "lowerBound";
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface ProbeResult {
  detectedLuceneMajor: number;
  pluginLuceneMajor: number;
  compatible: boolean;
  createdVersion?: string;
}

export interface CliError {
  code: string;
  message: string;
  retryable: boolean;
}

export type CliResponse<T> =
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

export interface ResolvedIndex {
  id: string;
  absolutePath: string;
  displayName: string;
  description: string;
  detectedLuceneMajor: number;
  manuallyAdded: boolean;
}

export interface LensPageState {
  status: PageStatus;
  selectedIndexId?: string;
  selectedLuceneMajor?: number;
  rows: DocumentRow[];
  pageNumber: number;
  pageSize: 25 | 50 | 100 | 200;
  total: string;
  totalRelation: "exact" | "lowerBound";
  query: string;
  analyzers: AnalyzerDefinition[];
  searchableFields: string[];
  inferredFieldTypes: Record<string, FieldType>;
  fieldTypes: Record<string, FieldType>;
  fieldTypeOverrides: Record<string, FieldType>;
  fieldTypeAnalyzers: Record<FieldType, AnalyzerName>;
  fieldAnalyzers: Record<string, AnalyzerName>;
  hasPrevious: boolean;
  hasNext: boolean;
  error?: string;
}

export type WebviewMessage =
  | {type: "ready"}
  | {type: "rescan"}
  | {type: "search"; query: string}
  | {type: "setFieldTypeAnalyzer"; fieldType: FieldType; analyzer: AnalyzerName}
  | {type: "setFieldType"; field: string; fieldType: FieldType}
  | {type: "setFieldAnalyzer"; field: string; analyzer: AnalyzerName}
  | {type: "removeFieldAnalyzer"; field: string}
  | {type: "pageSize"; pageSize: 25 | 50 | 100 | 200}
  | {type: "previousPage"}
  | {type: "nextPage"}
  | {type: "document"; docId: number}
  | {type: "export"};

export type HostMessage =
  | {type: "state"; state: LensPageState}
  | {type: "document"; document: DocumentRow}
  | {type: "notice"; message: string};
