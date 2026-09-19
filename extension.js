"use strict";

const vscode = require("vscode");
const { transformNotebook } = require("./lib/notebook");
const { dirtyNotebookKeys, resolveTargets } = require("./lib/targets");

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

class SourceChangedError extends Error {
  constructor(message = "The file changed while it was being processed.") {
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
    if (isDirty(uri)) throw new SourceChangedError("The notebook has unsaved edits.");
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
    `Updated ${summary.changed} of ${summary.total} notebook${summary.total === 1 ? "" : "s"}`,
    `removed ${summary.removedOutputs} output${summary.removedOutputs === 1 ? "" : "s"}`,
    `removed ${summary.removedCells} empty cell${summary.removedCells === 1 ? "" : "s"}`
  ];
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} unchanged`);
  if (summary.dirty > 0) parts.push(`${summary.dirty} unsaved skipped`);
  if (summary.conflicts > 0) parts.push(`${summary.conflicts} changed during processing`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed (see output)`);
  return `Notebook Cleaner: ${parts.join("; ")}.`;
}

async function run(mode, first, rest, output) {
  let targets;
  try {
    targets = await resolveTargets(selectedUris(first, rest), targetEnvironment());
  } catch (error) {
    output.appendLine(`[error] Could not resolve selected files: ${String(error)}`);
    void vscode.window.showErrorMessage("Notebook Cleaner: Could not inspect the selected files. See output for details.");
    return;
  }
  if (targets.length === 0) {
    void vscode.window.showInformationMessage("Notebook Cleaner: No notebooks found.");
    return;
  }

  const summary = emptySummary(targets.length);
  output.appendLine(`Starting ${mode} for ${targets.length} notebook(s).`);
  for (const uri of targets) {
    if (isDirty(uri)) {
      summary.dirty += 1;
      output.appendLine(`[skipped: unsaved] ${uri.toString()}`);
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
      output.appendLine(`[updated] ${uri.toString()}`);
    } catch (error) {
      if (error instanceof SourceChangedError) {
        if (isDirty(uri)) summary.dirty += 1;
        else summary.conflicts += 1;
        output.appendLine(`[skipped: changed] ${uri.toString()}: ${error.message}`);
      } else {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[failed] ${uri.toString()}: ${message}`);
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
