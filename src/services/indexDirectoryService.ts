import {createHash} from "node:crypto";
import {dirname} from "node:path";
import * as vscode from "vscode";
import type {ResolvedIndex} from "../protocol/types";
import {CliError, JavaCommandRunner} from "../platform/javaCommandRunner";
import {parseProbeResult} from "../protocol/validation";

const EXCLUDED_DIRECTORY = /(^|[\\/])(\.git|node_modules|dist|target|\.idea|\.vscode)([\\/]|$)/;

export class IndexDirectoryService implements vscode.Disposable {
  private readonly didScanEmitter = new vscode.EventEmitter<readonly ResolvedIndex[]>();
  private resolvedIndexes: ResolvedIndex[] = [];

  readonly onDidScan = this.didScanEmitter.event;

  constructor(
    private readonly runner: JavaCommandRunner,
    private readonly output: vscode.OutputChannel
  ) {}

  getCached(): ResolvedIndex[] {
    return [...this.resolvedIndexes];
  }

  async scan(token?: vscode.CancellationToken): Promise<ResolvedIndex[]> {
    const segmentFiles = (await vscode.workspace.findFiles("**/segments_*"))
      .filter((uri) => !EXCLUDED_DIRECTORY.test(uri.fsPath));
    const candidates = [...new Set(segmentFiles.map((uri) => dirname(uri.fsPath)))].sort();
    const results: ResolvedIndex[] = [];
    for (const absolutePath of candidates) {
      if (token?.isCancellationRequested) break;
      try {
        const probe = parseProbeResult(await this.runner.run<unknown>(
          "probe",
          ["--index", absolutePath],
          token
        ));
        if (!probe.compatible || probe.detectedLuceneMajor !== 9) {
          this.output.appendLine(`Skipped incompatible index: ${absolutePath}`);
          continue;
        }
        const uri = vscode.Uri.file(absolutePath);
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        const relative = folder ? vscode.workspace.asRelativePath(uri, false) : absolutePath;
        results.push({
          id: createHash("sha256").update(absolutePath).digest("hex").slice(0, 16),
          absolutePath,
          displayName: folder ? `${folder.name} / ${relative}` : relative,
          description: probe.createdVersion ?? "Lucene 9",
          detectedLuceneMajor: probe.detectedLuceneMajor
        });
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
      this.resolvedIndexes = results;
      this.didScanEmitter.fire(this.getCached());
    }
    return results;
  }

  dispose(): void {
    this.didScanEmitter.dispose();
  }
}
