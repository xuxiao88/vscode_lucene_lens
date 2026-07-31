export type PageStatus =
  | "untrusted"
  | "scanning"
  | "empty"
  | "loading"
  | "ready"
  | "error"
  | "cancelled";

export type AnalyzerName =
  | "standard"
  | "keyword"
  | "whitespace"
  | "simple"
  | "cjk"
  | "smartcn";

export type FieldAnalyzerSelection = AnalyzerName | "inherit";

export interface FieldSummary {
  name: string;
  indexed: boolean;
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
  analyzer: AnalyzerName;
  searchableFields: string[];
  fieldAnalyzers: Record<string, FieldAnalyzerSelection>;
  hasPrevious: boolean;
  hasNext: boolean;
  error?: string;
}

export type WebviewMessage =
  | {type: "ready"}
  | {type: "rescan"}
  | {type: "search"; query: string}
  | {type: "setAnalyzer"; analyzer: AnalyzerName}
  | {type: "setFieldAnalyzer"; field: string; analyzer: FieldAnalyzerSelection}
  | {type: "pageSize"; pageSize: 25 | 50 | 100 | 200}
  | {type: "previousPage"}
  | {type: "nextPage"}
  | {type: "document"; docId: number}
  | {type: "export"};

export type HostMessage =
  | {type: "state"; state: LensPageState}
  | {type: "document"; document: DocumentRow}
  | {type: "notice"; message: string};
