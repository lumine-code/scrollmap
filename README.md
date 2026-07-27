# scrollmap

Show markers on the scrollbar.

Core package providing scrollmap infrastructure for text editors and custom panes.

## Features

- **Layer system**: multiple packages can add markers to the scrollbar.
- **Column layout**: markers positioned in the left, center, or right column, or spanning the full width.
- **Cross-platform**: automatically adapts to scrollbar width on Windows, macOS, and Linux.
- **Toggle panel**: enable or disable layers individually.
- **Simplemap API**: support for non-editor panes like the PDF viewer.
- **Extensible**: other packages provide layers via the `marker.layer` service, and the same layer draws on the minimap.

## Installation

To install `scrollmap` search for _scrollmap_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/scrollmap`.

## Commands

Commands available in `atom-workspace`:

- `scrollmap:toggle-layers`: open a panel to enable or disable marker layers.

## Customization

The scrollbar width is measured automatically and stored as CSS variables on `:root`:

| Variable             | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `--scrollbar-width`  | Measured scrollbar width (e.g. 10px on Windows, 8px on Linux)       |
| `--scrollbar-bottom` | Bottom offset for horizontal scrollbar (0px for overlay scrollbars) |

Markers are drawn on a canvas for performance. Existing marker CSS classes are still used through hidden style resolver elements, so packages and user styles can keep setting marker color, opacity, width, height, and z-index with `.marker` rules.

Marker widths use percentages (40% center, 20% sides) to scale proportionally across platforms.

The style can be adjusted according to user preferences in the `styles.less` file, e.g. change marker width and opacity or style specific layers:

```less
.scrollmap .marker {
  width: 6px;
  opacity: 0.8;
}

.scrollmap .marker-mylayer {
  background-color: var(--text-color-info);
}
```

## Services

- **[marker.layer](docs/marker.layer.md)** (`^1.0.0`): consumed to let other packages register marker layers rendered on the editor scrollbar.
- **[scrollmap.widget](docs/scrollmap.widget.md)** (`1.0.0`): provided to expose a standalone scrollbar-marker widget class for non-editor panes.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
