# marker.layer

A package registers a named layer of markers that the editor's overview maps draw.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideMarkerLayer()` returning one layer descriptor   |
| Consumed by | `consumeMarkerLayer(provider)` returning a `Disposable` |
| Owner       | [`scrollmap`](https://github.com/lumine-code/scrollmap) |

Two packages consume this today — `scrollmap` draws the markers on the vertical scrollbar, `minimap` draws them on the minimap — and a layer is registered with both at once. `scrollmap` owns the contract because it is where it was written; a third map would change nothing here.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "marker.layer": {
      "versions": { "1.0.0": "provideMarkerLayer" }
    }
  }
}
```

Export `provideMarkerLayer` from your main module and return **one** descriptor object. A host keys layers by `provider.name` and never iterates an array, so returning an array registers a layer named `undefined` and draws nothing. A package that needs several layers declares several `providedServices` entries.

## Contract

Only `name` is required.

| Field  | Type   | Description                                                                                                                                     |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` | string | Layer identity. Becomes the CSS class `marker-<name>` and the key in each renderer's layer picker. Must be unique across every installed layer. |

Everything else is optional.

| Field         | Type                              | Default | Description                                                                                                 |
| ------------- | --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `description` | string                            | —       | Shown beside the layer in the renderers' layer pickers.                                                     |
| `position`    | `"left"` \| `"right"` \| `"full"` | —       | Column for every item in the layer. Each renderer maps it to its own width.                                 |
| `timer`       | number                            | `20`    | Throttle interval in milliseconds for `update()`.                                                           |
| `merge`       | boolean                           | `false` | Sort items and merge adjacent rows that share the same `cls` and `position`.                                |
| `threshold`   | string                            | —       | A config key path read as a limit. While the layer holds more items than the value there, it draws nothing. |
| `initialize`  | `(layer) => void`                 | —       | Called once per editor, per renderer, when the layer is attached to it.                                     |
| `getItems`    | `(layer) => item[] \| null`       | —       | Called on every update to produce the markers.                                                              |

A marker item:

| Field      | Type                              | Description                                               |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| `row`      | number                            | Screen row. Required.                                     |
| `end`      | number                            | Last screen row of a range; the marker spans `row`–`end`. |
| `cls`      | string                            | Extra CSS class, appended after `marker marker-<name>`.   |
| `position` | `"left"` \| `"right"` \| `"full"` | Overrides the layer's `position` for this item.           |

Rows are **screen** rows, not buffer rows, so folds and soft wrap move them. Each host subscribes to fold changes itself, so you do not need to.

The `layer` instance passed to `initialize` and `getItems`:

| Member         | Type                  | Description                                                                                                     |
| -------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `editor`       | `TextEditor`          | The editor this layer instance belongs to.                                                                      |
| `props`        | object                | The descriptor you returned.                                                                                    |
| `cache`        | `Map`                 | Free store for bridging external data into `getItems`. Write it from a service callback, read it in `getItems`. |
| `items`        | array                 | The current items. Read-only for providers.                                                                     |
| `disposables`  | `CompositeDisposable` | Disposed when the layer is destroyed.                                                                           |
| `update()`     | function              | Throttled. Re-runs `getItems` and re-renders.                                                                   |
| `updateSync()` | function              | `update()` without the throttle, for flicker-free handovers such as swapping the editors of a diff.             |

## Minimal example

```js
module.exports = {
  provideMarkerLayer() {
    return {
      name: "mylayer",
      description: "Rows that mention TODO",
      position: "left",
      merge: true,
      threshold: "mypackage.markerLimit",
      initialize: (layer) => {
        layer.disposables.add(layer.editor.onDidStopChanging(layer.update));
      },
      getItems: (layer) => {
        const rows = [];
        layer.editor.scan(/TODO/g, ({ range }) => rows.push({ row: range.start.row }));
        return rows;
      },
    };
  },
};
```

## Behavior

**A descriptor is stateless, and there is more than one layer per editor.** Every renderer builds its own `Layer` from the object you returned, so with both maps installed `initialize` runs twice for the same editor — once per renderer. Per-editor state belongs in `layer.cache`, never on the descriptor and never in a `Map` that holds one layer per editor; see [Teardown](#teardown).

A falsy `getItems` return keeps the previous items: return `null` to skip an update cycle, and an empty array to clear the layer.

The host copies every item before merging or thresholding it, so you may hand out cached objects without them being mutated. The array a renderer ends up with is shared with the other renderer — neither of them writes to it, and neither should you.

With `merge` and `threshold` you return raw, unsorted ranges and leave ordering, merging and the hide-when-noisy limit to the host. Merging joins two items when they carry the same `cls` and `position` and the second starts no more than one row after the first ends. Setting `threshold` also subscribes the layer to that config key. Each renderer scales the limit by its own `thresholdScale` setting, since a count that saturates an 8px strip means something else on a map showing a couple of hundred rows at a time.

**Styling.** A layer stylesheet sets **colour, opacity and z-index**; **geometry belongs to the renderer.** Write class-only rules so they resolve in either map, and keep the `.marker` qualifier so they cannot reach unrelated elements:

```css
.marker.marker-mylayer {
  z-index: 14;
  background-color: var(--text-color-info);
}
```

A class that resolves to no background colour draws nothing, and each renderer reports it once — usually a stylesheet still scoped to one map.

Registering a second layer under a name that is already taken logs a warning and returns a no-op `Disposable`; the second layer never draws. Nothing else reports a mistake — a misspelled service name, or a `provideMarkerLayer` that is not exported from the main module, produces no error at all. Run `npm run check:services` to catch the second.

If a layer registers but never appears, open the renderer's layer picker first: a layer the user has disabled looks exactly like one that never registered. The two maps keep separate lists, so a layer can be on in one and off in the other.

## Teardown

Add every subscription to `layer.disposables`. The host disposes it when the layer is destroyed — when the editor closes, when your package deactivates, or when the host itself is destroyed — and also cancels the pending throttle and clears `cache` and `items`.

To reach your layers from outside `getItems`, hold a **set** per editor. One layer per editor is not enough: a second renderer creates a second layer for the same editor, and a plain `Map` keyed by editor would keep only the last one — the first renderer would then quietly stop updating.

```js
initialize: (layer) => {
  let layers = this.layers.get(layer.editor);
  if (!layers) {
    layers = new Set();
    this.layers.set(layer.editor, layers);
  }
  layers.add(layer);
  layer.disposables.add(
    new Disposable(() => {
      layers.delete(layer);
      if (layers.size === 0) {
        this.layers.delete(layer.editor);
      }
    }),
  );
},
```

If the work behind a layer is expensive — an asynchronous request, a full-buffer scan — do it once per editor and let both layers read the result, rather than once per layer.

You never dispose anything yourself: `consumeMarkerLayer` returns the `Disposable` that unregisters your layer from every editor.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
