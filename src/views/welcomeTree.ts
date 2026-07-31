import * as vscode from "vscode";

export class WelcomeTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const item = new vscode.TreeItem("Open Lucene Lens", vscode.TreeItemCollapsibleState.None);
    item.command = {command: "luceneLens.open", title: "Open Lucene Lens"};
    item.iconPath = new vscode.ThemeIcon("search");
    item.tooltip = "Open the Lucene index viewer";
    return [item];
  }
}
