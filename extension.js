"use strict";

const vscode = require("vscode");
const { transformNotebook } = require("./lib/notebook");
const { dirtyNotebookKeys, resolveTargets } = require("./lib/targets");

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function t(message, ...args) {
  return vscode.l10n.t(message, ...args);
}

class SourceChangedError extends Error {
  constructor(message = t("The file changed while it was being processed.")) {
    super(message);
    this.name = "SourceChangedError";
  }
}

function equalBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function selectedUris(first, rest) {
  if (Array.isArray(rest) && rest.every((item) => item instanceof vscode.Uri)) return rest;
  return first instanceof vscode.Uri ? [first] : undefined;
}

function combinedExclude(patterns) {
  const filtered = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  if (filtered.length === 0) return undefined;
  return filtered.length === 1 ? filtered[0] : `{${filtered.join(",")}}`;
}

function targetEnvironment() {
  const exclude = combinedExclude(
    vscode.workspace.getConfiguration("notebookCleaner").get("exclude", [])
  );
  return {
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
    async isDirectory(uri) {
      const stat = await vscode.workspace.fs.stat(uri);
      return (stat.type & vscode.FileType.Directory) !== 0;
    },
    async findNotebooks(root) {
      return vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.ipynb"), exclude);
    }
  };
}

function isDirty(uri) {
  return dirtyNotebookKeys(vscode.workspace.notebookDocuments).has(uri.toString());
}

function siblingTemporaryUri(uri) {
  const slash = uri.path.lastIndexOf("/");
  const directory = uri.path.slice(0, slash + 1);
  const name = uri.path.slice(slash + 1);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return uri.with({ path: `${directory}.${name}.notebook-cleaner-${suffix}.tmp` });
}

async function atomicWrite(uri, original, replacement) {
  const temporary = siblingTemporaryUri(uri);
  let temporaryExists = false;
  try {
    await vscode.workspace.fs.writeFile(temporary, replacement);
    temporaryExists = true;
    if (isDirty(uri)) throw new SourceChangedError(t("The notebook has unsaved edits."));
    const current = await vscode.workspace.fs.readFile(uri);
    if (!equalBytes(current, original)) throw new SourceChangedError();
    await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
    temporaryExists = false;
  } finally {
    if (temporaryExists) {
      try {
        await vscode.workspace.fs.delete(temporary);
      } catch {
        // Best-effort cleanup must not hide the original error.
      }
    }
  }
}

function emptySummary(total) {
  return { total, changed: 0, unchanged: 0, dirty: 0, conflicts: 0, failed: 0, removedOutputs: 0, removedCells: 0 };
}

function summaryMessage(summary) {
  const parts = [
    t("Updated {0} of {1} Jupyter Notebook files", summary.changed, summary.total),
    t("removed {0} outputs", summary.removedOutputs),
    t("removed {0} empty cells", summary.removedCells)
  ];
  if (summary.unchanged > 0) parts.push(t("{0} unchanged", summary.unchanged));
  if (summary.dirty > 0) parts.push(t("skipped {0} with unsaved changes", summary.dirty));
  if (summary.conflicts > 0) parts.push(t("skipped {0} changed during processing", summary.conflicts));
  if (summary.failed > 0) parts.push(t("{0} failed (see output)", summary.failed));
  return t("Notebook Cleaner: {0}.", parts.join("; "));
}

function modeLabel(mode) {
  if (mode === "outputs") return t("clear outputs");
  if (mode === "emptyCells") return t("remove empty cells");
  return t("clear outputs and remove empty cells");
}

async function run(mode, first, rest, output) {
  let targets;
  try {
    targets = await resolveTargets(selectedUris(first, rest), targetEnvironment());
  } catch (error) {
    output.appendLine(`[${t("error")}] ${t("Could not resolve selected files")}: ${String(error)}`);
    void vscode.window.showErrorMessage(t("Notebook Cleaner: Could not inspect the selected files. See output for details."));
    return;
  }
  if (targets.length === 0) {
    void vscode.window.showInformationMessage(t("Notebook Cleaner: No Jupyter Notebook (.ipynb) files found."));
    return;
  }

  const summary = emptySummary(targets.length);
  output.appendLine(t("Starting {0} for {1} Jupyter Notebook files.", modeLabel(mode), targets.length));
  for (const uri of targets) {
    if (isDirty(uri)) {
      summary.dirty += 1;
      output.appendLine(`[${t("skipped: unsaved")}] ${uri.toString()}`);
      continue;
    }
    try {
      const original = await vscode.workspace.fs.readFile(uri);
      const result = transformNotebook(decoder.decode(original), mode);
      if (!result.changed) {
        summary.unchanged += 1;
        continue;
      }
      await atomicWrite(uri, original, encoder.encode(result.text));
      summary.changed += 1;
      summary.removedOutputs += result.removedOutputs;
      summary.removedCells += result.removedCells;
      output.appendLine(`[${t("updated")}] ${uri.toString()}`);
    } catch (error) {
      if (error instanceof SourceChangedError) {
        if (isDirty(uri)) summary.dirty += 1;
        else summary.conflicts += 1;
        output.appendLine(`[${t("skipped: changed")}] ${uri.toString()}: ${error.message}`);
      } else {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[${t("failed")}] ${uri.toString()}: ${message}`);
      }
    }
  }

  const message = summaryMessage(summary);
  if (summary.failed > 0) void vscode.window.showWarningMessage(message);
  else void vscode.window.showInformationMessage(message);
}

function activate(context) {
  const output = vscode.window.createOutputChannel("Notebook Cleaner", { log: true });
  context.subscriptions.push(output);
  const commands = [
    ["notebookCleaner.clearOutputs", "outputs"],
    ["notebookCleaner.removeEmptyCells", "emptyCells"],
    ["notebookCleaner.cleanNotebook", "all"]
  ];
  for (const [command, mode] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (first, rest) => run(mode, first, rest, output))
    );
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
