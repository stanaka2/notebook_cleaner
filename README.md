# Notebook Cleaner

Notebook Cleaner is a small VS Code extension that safely cleans Jupyter Notebook (`.ipynb`) files in bulk. It works directly with notebook JSON and does not require Python, Jupyter, a kernel, or `nbconvert`.

The extension has no telemetry, makes no network requests, and does not send notebook content anywhere.

## Features

- Clear every output and reset every code-cell execution count.
- Remove empty code and Markdown cells.
- Run both operations in the safe order: clear outputs, then remove empty cells.
- Process an entire workspace, a folder recursively, or selected files and folders.
- Support multi-root workspaces and remote file-system providers supported by VS Code.
- Preserve source, metadata, cell IDs, attachments, and notebook version fields.
- Avoid writing files that do not need changes.

## Installation

For local development, clone or copy this folder, open it in VS Code, and press **F5**. This starts an Extension Development Host with Notebook Cleaner installed. Runtime dependencies are not required.

## Usage

- From the Command Palette, run one of the Notebook Cleaner commands to process all `.ipynb` files in every open workspace folder.
- In Explorer, right-click an `.ipynb` file or folder and choose a Notebook Cleaner command.
- Explorer multi-selection is supported. Mixed files and folders are accepted, and duplicate paths are processed once.

There is no confirmation dialog. Commit important work or keep a separate backup before bulk changes.

## Commands

| Command | Action |
| --- | --- |
| `Notebook Cleaner: Clear All Outputs` | Empties `outputs` and sets `execution_count` to `null` in code cells. |
| `Notebook Cleaner: Remove Empty Cells` | Removes whitespace-only code and Markdown cells that have no outputs or attachments. |
| `Notebook Cleaner: Clean Notebook` | Clears outputs first, then removes empty cells. |

## Settings

`notebookCleaner.exclude` contains glob patterns excluded from recursive searches:

```json
{
  "notebookCleaner.exclude": [
    "**/.venv/**",
    "**/venv/**",
    "**/node_modules/**"
  ]
}
```

`.ipynb_checkpoints` is intentionally included unless you add an exclusion for it.

## Safety behavior

- An open notebook with unsaved edits is skipped.
- Dirty state is checked again immediately before replacing a file.
- The original bytes are checked again before replacement, so a concurrently changed file is not overwritten.
- A changed notebook is written to a sibling temporary file and then renamed over the original. A write failure therefore does not leave a partially written notebook.
- Invalid JSON and malformed notebook structures are skipped and reported in the **Notebook Cleaner** output channel.
- One failure does not stop other notebooks from being processed.
- Edits are applied only to the relevant JSON values and array entries; the entire document is not serialized again.

Clean notebooks that are open but not dirty may be updated. VS Code receives the file-system change and refreshes them. If an editor becomes dirty during processing, that file is skipped.

## Development

Requirements: a current Node.js LTS release for development and VS Code 1.85 or newer. The extension is plain JavaScript and has no runtime dependencies or compile step.

```sh
npm run check
```

Press **F5** in VS Code for an Extension Development Host. Open a disposable workspace containing test notebooks and exercise commands from both the Command Palette and Explorer.

## Packaging

Build a VSIX with the registered publisher identity `stanaka`:

```sh
npm run package
```

The packaging command uses `npx` to obtain the official `@vscode/vsce` tool when it is not already cached, so packaging may require network access. Running the extension does not.

Install it with **Extensions: Install from VSIX...** in VS Code. The extension ID is `stanaka.notebook-cleaner`. Author and icon metadata are optional and have intentionally been omitted.

## Known limitations

- Only `.ipynb` files are supported.
- Files must contain strict JSON and a valid top-level notebook structure.
- Cell output types are not filtered: all outputs are removed.
- There is no preview, backup manager, automatic clean-on-save, or notebook execution.
- File-system providers must support writing and renaming sibling files.

## License

[MIT](LICENSE)
