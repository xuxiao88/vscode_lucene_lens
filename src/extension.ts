import * as vscode from "vscode";
import {JavaCommandRunner} from "./platform/javaCommandRunner";
import {IndexDirectoryService} from "./services/indexDirectoryService";
import {IndexTree} from "./views/indexTree";
import {LensPanel} from "./webview/lensPanel";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Lucene Lens", {log: true});
  const runner = new JavaCommandRunner(context.extensionPath, output);
  const indexes = new IndexDirectoryService(runner, output);
  const indexTree = new IndexTree(indexes);
  const open = (): LensPanel => LensPanel.createOrShow(context, runner, indexes, output);

  context.subscriptions.push(
    output,
    runner,
    indexes,
    indexTree,
    vscode.window.createTreeView("luceneLens.indexes", {treeDataProvider: indexTree}),
    vscode.commands.registerCommand("luceneLens.open", () => open()),
    vscode.commands.registerCommand("luceneLens.openIndex", async (indexId: string) => {
      if (!indexTree.getIndex(indexId)) return;
      await open().openIndex(indexId);
    }),
    vscode.commands.registerCommand("luceneLens.refreshIndexes", () => indexTree.refresh()),
    vscode.commands.registerCommand("luceneLens.rescanWorkspace", async () => open().rescan()),
    vscode.commands.registerCommand("luceneLens.export", async () => open().exportCurrent()),
    vscode.commands.registerCommand("luceneLens.showLogs", () => output.show()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("luceneLens.java.home")) runner.resetJava();
    })
  );
}

export function deactivate(): void {
  LensPanel.getCurrent()?.dispose();
}
