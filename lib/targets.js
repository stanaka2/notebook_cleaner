"use strict";

function isNotebook(uri) {
  return uri.path.toLowerCase().endsWith(".ipynb");
}

async function resolveTargets(selected, environment) {
  const roots = selected && selected.length > 0 ? selected : environment.workspaceFolders;
  const found = new Map();
  for (const root of roots) {
    if (await environment.isDirectory(root)) {
      for (const notebook of await environment.findNotebooks(root)) {
        found.set(notebook.toString(), notebook);
      }
    } else if (isNotebook(root)) {
      found.set(root.toString(), root);
    }
  }
  return [...found.values()].sort((left, right) => left.toString().localeCompare(right.toString()));
}

function dirtyNotebookKeys(documents) {
  return new Set(documents.filter((document) => document.isDirty).map((document) => document.uri.toString()));
}

module.exports = { dirtyNotebookKeys, resolveTargets };
