"use strict";

class InvalidNotebookError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidNotebookError";
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class JsonLocator {
  constructor(text) {
    this.text = text;
    this.position = 0;
  }

  parse() {
    const node = this.parseValue();
    this.skipWhitespace();
    if (this.position !== this.text.length) {
      throw new InvalidNotebookError("Unexpected content after the JSON value.");
    }
    return node;
  }

  skipWhitespace() {
    while (/\s/u.test(this.text[this.position] ?? "")) {
      this.position += 1;
    }
  }

  parseValue() {
    this.skipWhitespace();
    const start = this.position;
    const character = this.text[this.position];
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === "t") return this.parseLiteral("true", "boolean");
    if (character === "f") return this.parseLiteral("false", "boolean");
    if (character === "n") return this.parseLiteral("null", "null");

    const match = this.text.slice(this.position).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) {
      throw new InvalidNotebookError(`Unexpected JSON token at offset ${start}.`);
    }
    this.position += match[0].length;
    return { type: "number", start, end: this.position };
  }

  parseString() {
    const start = this.position;
    this.position += 1;
    while (this.position < this.text.length) {
      const character = this.text[this.position];
      if (character === '"') {
        this.position += 1;
        return { type: "string", start, end: this.position };
      }
      if (character === "\\") {
        this.position += 2;
      } else {
        this.position += 1;
      }
    }
    throw new InvalidNotebookError("Unterminated JSON string.");
  }

  parseLiteral(literal, type) {
    const start = this.position;
    if (!this.text.startsWith(literal, start)) {
      throw new InvalidNotebookError(`Unexpected JSON token at offset ${start}.`);
    }
    this.position += literal.length;
    return { type, start, end: this.position };
  }

  parseObject() {
    const start = this.position;
    const properties = new Map();
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return { type: "object", start, end: this.position, properties };
    }

    while (this.position < this.text.length) {
      this.skipWhitespace();
      const propertyStart = this.position;
      const keyNode = this.parseString();
      const key = JSON.parse(this.text.slice(keyNode.start, keyNode.end));
      this.skipWhitespace();
      if (this.text[this.position] !== ":") {
        throw new InvalidNotebookError(`Expected ':' at offset ${this.position}.`);
      }
      this.position += 1;
      const value = this.parseValue();
      properties.set(key, { start: propertyStart, end: value.end, value });
      this.skipWhitespace();
      if (this.text[this.position] === "}") {
        this.position += 1;
        return { type: "object", start, end: this.position, properties };
      }
      if (this.text[this.position] !== ",") {
        throw new InvalidNotebookError(`Expected ',' at offset ${this.position}.`);
      }
      this.position += 1;
    }
    throw new InvalidNotebookError("Unterminated JSON object.");
  }

  parseArray() {
    const start = this.position;
    const items = [];
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return { type: "array", start, end: this.position, items };
    }

    while (this.position < this.text.length) {
      items.push(this.parseValue());
      this.skipWhitespace();
      if (this.text[this.position] === "]") {
        this.position += 1;
        return { type: "array", start, end: this.position, items };
      }
      if (this.text[this.position] !== ",") {
        throw new InvalidNotebookError(`Expected ',' at offset ${this.position}.`);
      }
      this.position += 1;
    }
    throw new InvalidNotebookError("Unterminated JSON array.");
  }
}

function property(node, name) {
  return node?.type === "object" ? node.properties.get(name)?.value : undefined;
}

function applyReplacements(text, replacements) {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => `${current.slice(0, edit.start)}${edit.text}${current.slice(edit.end)}`, text);
}

function removeArrayItem(text, arrayNode, index) {
  const item = arrayNode.items[index];
  if (arrayNode.items.length === 1) {
    return `${text.slice(0, item.start)}${text.slice(item.end)}`;
  }
  if (index < arrayNode.items.length - 1) {
    const next = arrayNode.items[index + 1];
    return `${text.slice(0, item.start)}${text.slice(next.start)}`;
  }
  const previous = arrayNode.items[index - 1];
  return `${text.slice(0, previous.end)}${text.slice(item.end)}`;
}

function sourceIsWhitespace(source) {
  if (typeof source === "string") return source.trim().length === 0;
  if (Array.isArray(source) && source.every((line) => typeof line === "string")) {
    return source.join("").trim().length === 0;
  }
  return false;
}

function hasAttachments(cell) {
  const attachments = cell.attachments;
  if (attachments === undefined || attachments === null) return false;
  if (isObject(attachments)) return Object.keys(attachments).length > 0;
  return true;
}

function hasOutputs(cell) {
  return Array.isArray(cell.outputs) ? cell.outputs.length > 0 : cell.outputs !== undefined;
}

function isRemovableCell(cell, outputsWillBeCleared) {
  if (cell.cell_type !== "code" && cell.cell_type !== "markdown") return false;
  if (!sourceIsWhitespace(cell.source) || hasAttachments(cell)) return false;
  return outputsWillBeCleared || !hasOutputs(cell);
}

function parseNotebook(text) {
  let notebook;
  try {
    notebook = JSON.parse(text);
  } catch (error) {
    throw new InvalidNotebookError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(notebook) || !Array.isArray(notebook.cells) || !notebook.cells.every(isObject)) {
    throw new InvalidNotebookError("The notebook does not contain a valid cells array.");
  }
  if (typeof notebook.nbformat !== "number") {
    throw new InvalidNotebookError("The notebook does not contain a numeric nbformat value.");
  }

  const root = new JsonLocator(text).parse();
  const cellsNode = property(root, "cells");
  if (!cellsNode || cellsNode.type !== "array" || cellsNode.items.length !== notebook.cells.length) {
    throw new InvalidNotebookError("The notebook cells could not be located safely.");
  }
  return { notebook, cellsNode };
}

function transformNotebook(input, mode) {
  const hasBom = input.startsWith("\uFEFF");
  let text = hasBom ? input.slice(1) : input;
  let { notebook, cellsNode } = parseNotebook(text);
  const clearOutputs = mode === "outputs" || mode === "all";
  const removeCells = mode === "emptyCells" || mode === "all";
  const replacements = [];
  const removableIndices = [];
  let removedOutputs = 0;

  for (let index = 0; index < notebook.cells.length; index += 1) {
    const cell = notebook.cells[index];
    const cellNode = cellsNode.items[index];
    if (clearOutputs && cell.cell_type === "code") {
      if (!Array.isArray(cell.outputs)) {
        throw new InvalidNotebookError(`Code cell ${index + 1} does not contain a valid outputs array.`);
      }
      if (!(cell.execution_count === null || typeof cell.execution_count === "number")) {
        throw new InvalidNotebookError(`Code cell ${index + 1} has an invalid execution_count.`);
      }
      const outputsNode = property(cellNode, "outputs");
      const countNode = property(cellNode, "execution_count");
      if (!outputsNode || !countNode) {
        throw new InvalidNotebookError(`Code cell ${index + 1} is missing required fields.`);
      }
      if (cell.outputs.length > 0) {
        removedOutputs += cell.outputs.length;
        replacements.push({ start: outputsNode.start, end: outputsNode.end, text: "[]" });
      }
      if (cell.execution_count !== null) {
        replacements.push({ start: countNode.start, end: countNode.end, text: "null" });
      }
    }
    if (removeCells && isRemovableCell(cell, clearOutputs)) removableIndices.push(index);
  }

  text = applyReplacements(text, replacements);
  for (const index of [...removableIndices].reverse()) {
    ({ cellsNode } = parseNotebook(text));
    text = removeArrayItem(text, cellsNode, index);
  }

  if (hasBom) text = `\uFEFF${text}`;
  return {
    text,
    changed: text !== input,
    removedOutputs,
    removedCells: removableIndices.length
  };
}

module.exports = { InvalidNotebookError, transformNotebook };
