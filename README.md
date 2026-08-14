# scrollmap

Show markers on the scrollbar.

A strip beside every editor scrollbar drawing the layers the `marker` package computes — git changes, linter messages, search hits and more — plus the same widget for custom panes.

## Features

- **Layer system**: marker layers registered with the `marker` hub are drawn beside the scrollbar, computed once and shared with the minimap.
- **Column layout**: markers positioned in the left, center, or right column, or spanning the full width.
- **Cross-platform**: automatically adapts to scrollbar width on Windows, macOS, and Linux, and floats at its own width where scrollbars overlay the content.
- **Toggle panel**: enable or disable layers individually, for this strip alone.
- **Simplemap API**: support for non-editor panes like the PDF viewer.

## Installation

To install `scrollmap` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/scrollmap`.

## Commands

Commands available in `lumine-workspace`:

- `scrollmap:show-layers`: open a picker to enable or disable marker layers.

## Customization

The scrollbar width is measured automatically and stored as CSS variables on `:root`:

| Variable             | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `--scrollbar-width`  | Measured scrollbar width (e.g. 10px on Windows, 8px on Linux)       |
| `--scrollbar-bottom` | Bottom offset for horizontal scrollbar (0px for overlay scrollbars) |

Markers are drawn on a canvas for performance. Existing marker CSS classes are still used through hidden style resolver elements, so packages and user styles can keep setting marker color, opacity, width, height, and z-index with `.marker` rules.

Marker widths use percentages (40% center, 20% sides) to scale proportionally across platforms.

The style can be adjusted according to user preferences in the `styles.css` file, e.g. change marker width and opacity or style specific layers:

```css
.scrollmap .marker {
  width: 6px;
  opacity: 0.8;
}

.scrollmap .marker-mylayer {
  background-color: var(--text-color-info);
}
```

## Services

- `marker.registry`: consumed to read every editor's computed marker layers and the toolkit that draws them.
- [`scrollmap.widget`](docs/scrollmap.widget.md): provided to expose a standalone scrollbar-marker widget class for non-editor panes.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
