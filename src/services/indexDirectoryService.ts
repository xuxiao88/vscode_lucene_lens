import {createHash} from "node:crypto";
import {dirname, resolve} from "node:path";
import * as vscode from "vscode";
import type {ResolvedIndex} from "../protocol/types";
import {CliError, JavaCommandRunner} from "../platform/javaCommandRunner";
import {parseProbeResult} from "../protocol/validation";
import {WorkspaceSettingsService} from "./workspaceSettingsService";

const EXCLUDED_DIRECTORY = /(^|[\\/])(\.git|node_modules|dist|target|\.idea|\.vscode)([\\/]|$)/;

export class IndexDirectoryService implements vscode.Disposable {
  private readonly didScanEmitter = new vscode.EventEmitter<readonly ResolvedIndex[]>();
  private resolvedIndexes: ResolvedIndex[] = [];
  private readonly manualIndexPaths = new Set<string>();
  private readonly automaticIndexPaths = new Set<string>();
  private manualIndexesLoaded = false;

  readonly onDidScan = this.didScanEmitter.event;

  constructor(
    private readonly runner: JavaCommandRunner,
    private readonly workspaceSettings: WorkspaceSettingsService,
    private readonly output: vscode.OutputChannel
  ) {}

  getCached(): ResolvedIndex[] {
    return [...this.resolvedIndexes];
  }

  async addManual(absolutePath: string, token?: vscode.CancellationToken): Promise<ResolvedIndex> {
    await this.loadManualIndexes();
    const normalizedPath = resolve(absolutePath);
    const index = await this.probe(normalizedPath, true, token);
    if (!index) {
      throw new Error("The selected directory is not a compatible Lucene 9 index.");
    }
    if (!this.manualIndexPaths.has(normalizedPath)) {
      await this.workspaceSettings.addManualIndexPath(normalizedPath);
      this.manualIndexPaths.add(normalizedPath);
    }
    this.resolvedIndexes = mergeIndexes([...this.resolvedIndexes, index]);
    this.didScanEmitter.fire(this.getCached());
    return index;
  }

  async removeManual(indexId: string): Promise<boolean> {
    await this.loadManualIndexes();
    const index = this.resolvedIndexes.find(
      (candidate) => candidate.id === indexId && candidate.manuallyAdded
    );
    if (!index) return false;
    await this.workspaceSettings.removeManualIndexPath(index.absolutePath);
    this.manualIndexPaths.delete(index.absolutePath);
    this.resolvedIndexes = this.automaticIndexPaths.has(index.absolutePath)
      ? this.resolvedIndexes.map((candidate) =>
          candidate.absolutePath === index.absolutePath
            ? {...candidate, manuallyAdded: false}
            : candidate)
      : this.resolvedIndexes.filter((candidate) => candidate.absolutePath !== index.absolutePath);
    this.didScanEmitter.fire(this.getCached());
    return true;
  }

  async scan(token?: vscode.CancellationToken): Promise<ResolvedIndex[]> {
    await this.loadManualIndexes();
    const segmentFiles = (await vscode.workspace.findFiles("**/segments_*"))
      .filter((uri) => !EXCLUDED_DIRECTORY.test(uri.fsPath));
    const automaticCandidates = new Set(
      segmentFiles.map((uri) => resolve(dirname(uri.fsPath)))
    );
    const candidates = [
      ...new Set([
        ...automaticCandidates,
        ...this.manualIndexPaths
      ])
    ].sort();
    const results: ResolvedIndex[] = [];
    const validAutomaticIndexes = new Set<string>();
    for (const absolutePath of candidates) {
      if (token?.isCancellationRequested) break;
      try {
        const index = await this.probe(
          absolutePath,
          this.manualIndexPaths.has(absolutePath),
          token
        );
        if (index) {
          results.push(index);
          if (automaticCandidates.has(absolutePath)) {
            validAutomaticIndexes.add(absolutePath);
          }
        }
      } catch (error) {
        if (error instanceof CliError
            && (error.code.startsWith("JAVA_")
              || error.code.startsWith("PROCESS_")
              || error.code.startsWith("LUCENE_PLUGIN_"))) {
          throw error;
        }
        this.output.appendLine(
          `Index probe failed for ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    if (!token?.isCancellationRequested) {
      this.automaticIndexPaths.clear();
      for (const path of validAutomaticIndexes) this.automaticIndexPaths.add(path);
      this.resolvedIndexes = mergeIndexes(results);
      this.didScanEmitter.fire(this.getCached());
    }
    return this.getCached();
  }

  dispose(): void {
    this.didScanEmitter.dispose();
  }

  private async probe(
    absolutePath: string,
    manuallyAdded: boolean,
    token?: vscode.CancellationToken
  ): Promise<ResolvedIndex | undefined> {
    const probe = parseProbeResult(await this.runner.run<unknown>(
      "probe",
      ["--index", absolutePath],
      token
    ));
    if (!probe.compatible || probe.detectedLuceneMajor !== 9) {
      this.output.appendLine(`Skipped incompatible index: ${absolutePath}`);
      return undefined;
    }
    const uri = vscode.Uri.file(absolutePath);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relative = folder ? vscode.workspace.asRelativePath(uri, false) : absolutePath;
    return {
      id: createHash("sha256").update(absolutePath).digest("hex").slice(0, 16),
      absolutePath,
      displayName: folder ? `${folder.name} / ${relative}` : relative,
      description: probe.createdVersion ?? "Lucene 9",
      detectedLuceneMajor: probe.detectedLuceneMajor,
      manuallyAdded
    };
  }

  private async loadManualIndexes(): Promise<void> {
    if (this.manualIndexesLoaded) return;
    const paths = await this.workspaceSettings.loadManualIndexPaths();
    for (const path of paths) this.manualIndexPaths.add(resolve(path));
    this.manualIndexesLoaded = true;
  }
}

function mergeIndexes(indexes: ResolvedIndex[]): ResolvedIndex[] {
  const merged = new Map<string, ResolvedIndex>();
  for (const index of indexes) {
    const existing = merged.get(index.absolutePath);
    merged.set(
      index.absolutePath,
      existing
        ? {...index, manuallyAdded: existing.manuallyAdded || index.manuallyAdded}
        : index
    );
  }
  return [...merged.values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}
