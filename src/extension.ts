import * as vscode from "vscode";
import {CliError, JavaCommandRunner} from "./platform/javaCommandRunner";
import {IndexDirectoryService} from "./services/indexDirectoryService";
import {WorkspaceSettingsService} from "./services/workspaceSettingsService";
import {IndexTree} from "./views/indexTree";
import {LensPanel} from "./webview/lensPanel";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Lucene Lens", {log: true});
  const runner = new JavaCommandRunner(context.extensionPath, output);
  const workspaceSettings = new WorkspaceSettingsService(output);
  const indexes = new IndexDirectoryService(runner, workspaceSettings, output);
  const indexTree = new IndexTree(indexes);
  const open = (): LensPanel =>
    LensPanel.createOrShow(context, runner, indexes, workspaceSettings, output);

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
    vscode.commands.registerCommand("luceneLens.chooseIndexDirectory", async () => {
      if (!vscode.workspace.isTrusted) {
        await vscode.window.showWarningMessage(
          "Trust this workspace before opening a Lucene index."
        );
        return;
      }
      const selected = await vscode.window.showOpenDialog({
        title: "Select a Lucene index directory",
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Open Index"
      });
      const directory = selected?.[0];
      if (!directory) return;
      try {
        const index = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Validating Lucene index",
            cancellable: true
          },
          (_progress, token) => indexes.addManual(directory.fsPath, token)
        );
        await open().openIndex(index.id);
      } catch (error) {
        if (error instanceof CliError && error.code === "REQUEST_CANCELLED") return;
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`Manual index selection failed for ${directory.fsPath}: ${message}`);
        await vscode.window.showErrorMessage(`Unable to open Lucene index: ${message}`);
      }
    }),
    vscode.commands.registerCommand("luceneLens.refreshIndexes", () => indexTree.refresh()),
    vscode.commands.registerCommand(
      "luceneLens.removeIndex",
      async (item: vscode.TreeItem | undefined) => {
        if (!item?.id) return;
        try {
          if (await indexes.removeManual(item.id)) {
            await LensPanel.getCurrent()?.indexesChanged();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output.appendLine(`Unable to remove manual index: ${message}`);
          await vscode.window.showErrorMessage(
            `Unable to remove the Lucene index from the list: ${message}`
          );
        }
      }
    ),
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
