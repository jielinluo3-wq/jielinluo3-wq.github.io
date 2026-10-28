# CanvasCode integration
Source: https://github.com/al1830329386-dev/canvascode
Original tweak-engine.js SHA: 7d062b342f28fdea1529177ae1749b82adf47b89
License: GPL-3.0 (see LICENSE). Original source and README are retained in outputs/canvascode.

Local changes, 2026-10-21: isolated static snapshot workspace; leaf-only text editing; text undo fix; independent CSS translation to preserve rotation/centering; undoable image/link attributes; selection/change bridge; host reset delegation. The editable workspace is localhost-only. Drafts are browser-local proposals, not source code or a publication system.

2026-10-22: text-node runs in mixed-content elements are editable without removing icons or line breaks; searchable text picker; contenteditable arrow keys no longer trigger layout hotkeys; selection bridge added. Existing draft element IDs are preserved.

Text-only selections use non-interactive border/resize handles so double-clicking small text reaches the text node. Images retain draggable borders and resize handles.
