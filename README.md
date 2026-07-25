# scrollmap

Show markers on the scroll bar. Core package providing scrollmap infrastructure for text editors and custom panes.

## Features

- **Layer system**: multiple packages can add markers to the scrollbar.
- **3-column layout**: markers positioned in left, center, or right columns.
- **Cross-platform**: automatically adapts to scrollbar width on Windows, macOS, and Linux.
- **Toggle panel**: enable or disable layers individually.
- **Simplemap API**: support for non-editor panes like the PDF viewer.
- **Extensible**: other packages provide layers via the `scrollmap` service.

## Installation

To install `scrollmap` search for _scrollmap_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/scrollmap`.

## Commands

Commands available in `atom-workspace`:

- `scrollmap:toggle-layers`: open a panel to enable or disable marker layers.

## Usage

### The `scrollmap` service

Allows other packages to add custom marker layers to the scrollbar. Each layer provider returns a descriptor with initialization and item-fetching callbacks.

In your `package.json`:

```json
{
  "providedServices": {
    "scrollmap": {
      "versions": { "1.0.0": "provideScrollmap" }
    }
  }
}
```

In your main module:

```javascript
provideScrollmap() {
  return {
    name: "mylayer",
    description: "My layer description",
    position: "left",
    initialize: ({ editor, cache, disposables, update }) => {
      disposables.add(
        editor.onDidStopChanging(update),
      );
    },
    getItems: ({ editor, cache }) => {
      return [
        { row: 10 },
        { row: 20, cls: "special" },
        { row: 30, end: 35, cls: "special" },
      ];
    },
  };
}
```

Provider properties:

| Property      | Type     | Description                                        |
| ------------- | -------- | -------------------------------------------------- |
| `name`        | string   | Layer name (CSS class: `marker-{name}`)            |
| `description` | string   | Layer description shown in toggle panel (optional) |
| `position`    | string   | Position class e.g. `left`, `right` (optional)     |
| `timer`       | number   | Throttle interval in ms (default: 20)              |
| `initialize`  | function | `(layer) => void` - set up layer                   |
| `getItems`    | function | `(layer) => items[]` - return markers to render    |

Both `initialize` and `getItems` receive the layer instance. It can also be accessed externally via `editor.scrollmap.layers.get(name)` to push data from service consumers.

| Member        | Type                | Description                                                                                                                                                                     |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor`      | TextEditor          | The editor this layer belongs to                                                                                                                                                |
| `props`       | object              | The provider descriptor passed to `provideScrollmap`                                                                                                                            |
| `cache`       | Map                 | Persistent store to bridge external service data into `getItems`. Set data from service callbacks with `cache.set("data", ...)`, read it in `getItems` with `cache.get("data")` |
| `items`       | array               | Current marker items populated from `getItems` return value. Read-only for consumers                                                                                            |
| `disposables` | CompositeDisposable | Add subscriptions and cleanup callbacks here. Auto-disposed on layer destroy                                                                                                    |
| `update()`    | function            | Throttled. Re-runs `getItems`, recalculates pixel positions, and re-renders                                                                                                     |
| `refresh()`   | function            | Throttled. Recalculates pixel positions and re-renders without calling `getItems`. Used internally on fold and decoration changes                                               |

`update` has higher priority than `refresh`. If `update` is pending, `refresh` calls are skipped. If `refresh` is pending, an `update` call replaces it.

Marker item properties:

| Property | Type   | Description                                                              |
| -------- | ------ | ------------------------------------------------------------------------ |
| `row`    | number | Screen row for the marker                                                |
| `end`    | number | Last screen row of the range (optional). Marker height spans `row`-`end` |
| `cls`    | string | Additional CSS class (optional)                                          |

### The `simplemap` service

Provides a scrollbar widget for non-editor panes (like the PDF viewer). Consumers receive a `Simplemap` constructor to create standalone scrollbar markers.

In your `package.json`:

```json
{
  "consumedServices": {
    "simplemap": {
      "versions": { "1.0.0": "consumeSimplemap" }
    }
  }
}
```

In your main module:

```javascript
consumeSimplemap(Simplemap) {
  const simplemap = new Simplemap();
  simplemap.setItems([
    { prc: 10, cls: "marker-h1" },
    { prc: 50, end: 60, cls: "marker-h2" },
  ]);
  container.appendChild(simplemap.element);
  return new Disposable(() => simplemap.destroy());
}
```

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

- **scrollmap** (`^1.0.0`): consumed to let other packages register marker layers rendered on the editor scrollbar.
- **simplemap** (`1.0.0`): provided to expose a standalone scrollbar-marker widget class for non-editor panes.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
