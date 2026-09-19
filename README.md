# Notebook Cleaner

Bulk-clean Jupyter Notebook (`.ipynb`) files from VS Code. Clear outputs, reset execution counts, and remove empty cells across a workspace, folder, or file selection.

No Python, Jupyter, kernel, or `nbconvert` installation is required. The extension has no telemetry or network access.

## Features

- Clear all code-cell outputs and set `execution_count` to `null`.
- Remove whitespace-only code and Markdown cells with no outputs or attachments.
- Clean a whole workspace, folders recursively, or multiple Explorer selections.
- Support multi-root and remote workspaces through VS Code file-system APIs.
- Preserve source, metadata, cell IDs, attachments, and notebook version fields.

## Installation

Install `stanaka.notebook-cleaner` from the VS Code Extensions view.

## Usage

Run a command from the Command Palette to process the workspace, or right-click `.ipynb` files and folders in Explorer. Mixed and duplicate selections are handled automatically.

| Command | Action |
| --- | --- |
| `Notebook Cleaner: Clear All Outputs` | Remove all outputs and reset execution counts. |
| `Notebook Cleaner: Remove Empty Cells` | Remove empty code and Markdown cells. |
| `Notebook Cleaner: Clean Notebook` | Clear outputs, then remove empty cells. |

There is no confirmation dialog. Commit important work or keep a backup before bulk changes.

## Settings

Recursive searches exclude `.venv`, `venv`, and `node_modules` by default. Customize the glob list with `notebookCleaner.exclude`. `.ipynb_checkpoints` remains included unless explicitly excluded.

## Safety

- Unsaved open notebooks are skipped and reported.
- Unchanged notebooks are not rewritten.
- Files changed during processing are not overwritten.
- Only relevant JSON values are edited; the complete document is not reserialized.
- Changes use a sibling temporary file before replacing the original.
- Invalid notebooks are reported without stopping the remaining batch.

Details are available in the **Notebook Cleaner** output channel.

## Limitations

Only strict-JSON `.ipynb` files are supported. All output types are removed; there is no preview, automatic clean-on-save, backup manager, or notebook execution.

## License

[MIT](LICENSE)
