import {relative, sep} from "node:path";
import * as vscode from "vscode";
import type {AnalyzerSettings} from "../protocol/types";
import {isAnalyzerName} from "../protocol/validation";

const SETTINGS_DIRECTORY = ".vscode";
const SETTINGS_FILE = "lucene-lens.json";

interface WorkspaceSettingsFile {
  version: 1;
  indexes: Record<string, AnalyzerSettings>;
}

interface SettingsTarget {
  directoryUri: vscode.Uri;
  fileUri: vscode.Uri;
  indexKey: string;
}

export class WorkspaceSettingsService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly output: vscode.OutputChannel) {}

  async load(indexPath: string): Promise<AnalyzerSettings | undefined> {
    const target = this.resolveTarget(indexPath);
    if (!target) return undefined;
    const settings = await this.read(target.fileUri);
    const configured = settings.indexes[target.indexKey];
    return configured
      ? {
          analyzer: configured.analyzer,
          fieldAnalyzers: {...configured.fieldAnalyzers}
        }
      : undefined;
  }

  save(indexPath: string, settings: AnalyzerSettings): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const target = this.resolveTarget(indexPath);
      if (!target) {
        throw new Error(
          "Open a workspace folder before saving Lucene Lens query settings."
        );
      }
      const file = await this.read(target.fileUri);
      file.indexes[target.indexKey] = {
        analyzer: settings.analyzer,
        fieldAnalyzers: {...settings.fieldAnalyzers}
      };
      await vscode.workspace.fs.createDirectory(target.directoryUri);
      await vscode.workspace.fs.writeFile(
        target.fileUri,
        new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`)
      );
      this.output.appendLine(`Saved query settings to ${target.fileUri.toString()}`);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private resolveTarget(indexPath: string): SettingsTarget | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
    const indexUri = vscode.Uri.file(indexPath);
    const containingFolder = vscode.workspace.getWorkspaceFolder(indexUri);
    const storageFolder = containingFolder ?? workspaceFolders[0];
    if (!storageFolder) return undefined;
    const directoryUri = vscode.Uri.joinPath(storageFolder.uri, SETTINGS_DIRECTORY);
    return {
      directoryUri,
      fileUri: vscode.Uri.joinPath(directoryUri, SETTINGS_FILE),
      indexKey: containingFolder
        ? normalizeRelativePath(relative(containingFolder.uri.fsPath, indexUri.fsPath))
        : indexUri.toString(true)
    };
  }

  private async read(fileUri: vscode.Uri): Promise<WorkspaceSettingsFile> {
    let content: Uint8Array;
    try {
      content = await vscode.workspace.fs.readFile(fileUri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return {version: 1, indexes: Object.create(null) as Record<string, AnalyzerSettings>};
      }
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(content));
    } catch {
      throw new Error(`${fileUri.fsPath} is not valid JSON.`);
    }
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.indexes)) {
      throw new Error(`${fileUri.fsPath} has an unsupported Lucene Lens settings format.`);
    }
    const indexes = Object.create(null) as Record<string, AnalyzerSettings>;
    for (const [indexKey, rawSettings] of Object.entries(value.indexes)) {
      if (!isAnalyzerSettings(rawSettings)) {
        throw new Error(
          `${fileUri.fsPath} contains invalid query settings for index '${indexKey}'.`
        );
      }
      indexes[indexKey] = {
        analyzer: rawSettings.analyzer,
        fieldAnalyzers: {...rawSettings.fieldAnalyzers}
      };
    }
    return {version: 1, indexes};
  }
}

function normalizeRelativePath(value: string): string {
  if (!value) return ".";
  return sep === "/" ? value : value.split(sep).join("/");
}

function isAnalyzerSettings(value: unknown): value is AnalyzerSettings {
  return isRecord(value)
    && isAnalyzerName(value.analyzer)
    && isRecord(value.fieldAnalyzers)
    && Object.values(value.fieldAnalyzers).every(isAnalyzerName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
