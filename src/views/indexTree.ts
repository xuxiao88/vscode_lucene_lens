import * as vscode from "vscode";
import type {ResolvedIndex} from "../protocol/types";
import {IndexDirectoryService} from "../services/indexDirectoryService";

type TreeState = "idle" | "scanning" | "ready" | "empty" | "untrusted" | "error";

export class IndexTree implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly didChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private cancellation: vscode.CancellationTokenSource | undefined;
  private state: TreeState = "idle";
  private indexes: ResolvedIndex[] = [];
  private error: string | undefined;

  readonly onDidChangeTreeData = this.didChangeTreeDataEmitter.event;

  constructor(private readonly indexService: IndexDirectoryService) {
    this.disposables.push(
      this.indexService.onDidScan((indexes) => {
        this.indexes = [...indexes];
        this.state = this.indexes.length > 0 ? "ready" : "empty";
        this.error = undefined;
        this.didChangeTreeDataEmitter.fire();
      })
    );
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state === "idle") {
      void this.refresh();
      return [this.statusItem("Scanning workspace indexes…", "loading~spin")];
    }
    if (this.state === "scanning") {
      return [this.statusItem("Scanning workspace indexes…", "loading~spin")];
    }
    if (this.state === "untrusted") {
      return [this.statusItem("Trust this workspace to scan indexes", "shield")];
    }
    if (this.state === "error") {
      const item = this.statusItem("Index scan failed", "error");
      item.tooltip = this.error;
      return [item];
    }
    if (this.state === "empty") {
      return [this.statusItem("No Lucene indexes found", "info")];
    }
    return this.indexes.map((index) => {
      const item = new vscode.TreeItem(index.displayName, vscode.TreeItemCollapsibleState.None);
      item.id = index.id;
      item.description = index.description;
      item.tooltip = index.absolutePath;
      item.iconPath = new vscode.ThemeIcon("database");
      item.contextValue = "luceneIndex";
      item.command = {
        command: "luceneLens.openIndex",
        title: "Open Lucene Index",
        arguments: [index.id]
      };
      return item;
    });
  }

  getIndex(indexId: string): ResolvedIndex | undefined {
    return this.indexes.find((index) => index.id === indexId);
  }

  async refresh(): Promise<void> {
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.cancellation = undefined;
    if (!vscode.workspace.isTrusted) {
      this.indexes = [];
      this.state = "untrusted";
      this.error = undefined;
      this.didChangeTreeDataEmitter.fire();
      return;
    }
    const cancellation = new vscode.CancellationTokenSource();
    this.cancellation = cancellation;
    this.state = "scanning";
    this.error = undefined;
    this.didChangeTreeDataEmitter.fire();
    try {
      await this.indexService.scan(cancellation.token);
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        this.state = "error";
        this.error = error instanceof Error ? error.message : String(error);
        this.didChangeTreeDataEmitter.fire();
      }
    } finally {
      if (this.cancellation === cancellation) {
        cancellation.dispose();
        this.cancellation = undefined;
      }
    }
  }

  dispose(): void {
    this.cancellation?.cancel();
    this.cancellation?.dispose();
    this.didChangeTreeDataEmitter.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private statusItem(label: string, icon: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
