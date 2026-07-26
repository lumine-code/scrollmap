# scrollmap.layer

A package registers a named layer of markers that scrollmap draws on the vertical scrollbar of every text editor.

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Version     | `1.0.0`                                                    |
| Provided by | `provideScrollmapLayer()` returning one layer descriptor   |
| Consumed by | `consumeScrollmapLayer(provider)` returning a `Disposable` |
| Owner       | [`scrollmap`](https://github.com/lumine-code/scrollmap)    |

`scrollmap` consumes this service even though it defines the contract: it is the hub, and the packages that draw markers provide into it.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "scrollmap.layer": {
      "versions": { "1.0.0": "provideScrollmapLayer" }
    }
  }
}
```

Export `provideScrollmapLayer` from your main module and return **one** descriptor object. The hub keys layers by `provider.name` and never iterates an array, so returning an array registers a layer named `undefined` and draws nothing. A package that needs several layers declares several `providedServices` entries.

## Contract

Only `name` is required.

| Field  | Type   | Description                                                                                                                                  |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` | string | Layer identity. Becomes the CSS class `marker-<name>` and the key in `scrollmap:toggle-layers`. Must be unique across every installed layer. |

Everything else is optional.

| Field         | Type                              | Default  | Description                                                                                                 |
| ------------- | --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `description` | string                            | —        | Shown beside the layer in `scrollmap:toggle-layers`.                                                        |
| `position`    | `"left"` \| `"right"` \| `"full"` | centered | Column for every item in the layer.                                                                         |
| `timer`       | number                            | `20`     | Throttle interval in milliseconds for `update()` and `refresh()`.                                           |
| `merge`       | boolean                           | `false`  | Sort items and merge adjacent rows that share the same `cls` and `position`.                                |
| `threshold`   | string                            | —        | A config key path read as a limit. While the layer holds more items than the value there, it draws nothing. |
| `initialize`  | `(layer) => void`                 | —        | Called once per editor, when the layer is attached to it.                                                   |
| `getItems`    | `(layer) => item[] \| null`       | —        | Called on every update to produce the markers.                                                              |

A marker item:

| Field      | Type                              | Description                                               |
| ---------- | --------------------------------- | --------------------------------------------------------- |
| `row`      | number                            | Screen row. Required.                                     |
| `end`      | number                            | Last screen row of a range; the marker spans `row`–`end`. |
| `cls`      | string                            | Extra CSS class, appended after `marker marker-<name>`.   |
| `position` | `"left"` \| `"right"` \| `"full"` | Overrides the layer's `position` for this item.           |

Rows are **screen** rows, not buffer rows, so folds and soft wrap move them. The hub calls `refresh()` on fold and decoration changes, so you do not need to subscribe to those yourself.

The `layer` instance passed to `initialize` and `getItems`:

| Member          | Type                  | Description                                                                                                     |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `editor`        | `TextEditor`          | The editor this layer instance belongs to.                                                                      |
| `props`         | object                | The descriptor you returned.                                                                                    |
| `cache`         | `Map`                 | Free store for bridging external data into `getItems`. Write it from a service callback, read it in `getItems`. |
| `items`         | array                 | The current items. Read-only for providers.                                                                     |
| `disposables`   | `CompositeDisposable` | Disposed when the layer is destroyed.                                                                           |
| `update()`      | function              | Throttled. Re-runs `getItems`, recomputes pixel positions, re-renders.                                          |
| `refresh()`     | function              | Throttled. Recomputes and re-renders **without** calling `getItems`.                                            |
| `updateSync()`  | function              | `update()` without the throttle, for flicker-free handovers such as swapping the editors of a diff.             |
| `refreshSync()` | function              | `refresh()` without the throttle.                                                                               |

## Minimal example

```js
module.exports = {
  provideScrollmapLayer() {
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

One layer instance exists per open editor, and another is created for every editor opened later, so `initialize` runs once per editor rather than once per package.

The hub copies every item returned by `getItems` before merging or thresholding it, so you may hand out cached objects without them being mutated.

A falsy `getItems` return keeps the previous items: return `null` to skip an update cycle, and an empty array to clear the layer.

`update()` outranks `refresh()`. While an `update()` is pending, `refresh()` calls are dropped; a pending `refresh()` is replaced by an `update()`.

With `merge` and `threshold` you return raw, unsorted ranges and leave ordering, merging, and the hide-when-noisy limit to the hub. Merging joins two items when they carry the same `cls` and `position` and the second starts no more than one row after the first ends. Setting `threshold` also subscribes the layer to that config key, so it re-renders when the user changes the setting.

Registering a second layer under a name that is already taken logs a warning and returns a no-op `Disposable`; the second layer never draws. Nothing else reports a mistake — a misspelled service name, or a `provideScrollmapLayer` that is not exported from the main module, produces no error at all. Run `npm run check:services` to catch the second.

If a layer registers but never appears, open `scrollmap:toggle-layers` first: a layer the user has disabled looks exactly like one that never registered.

## Teardown

Add every subscription to `layer.disposables`. The hub disposes it when the layer is destroyed — when the editor closes, when your package deactivates, or when the hub itself is destroyed — and also cancels the pending throttle and clears `cache` and `items`.

To hold a reference to a layer from outside `getItems`, drop it in the same place:

```js
initialize: (layer) => {
  this.layers.set(layer.editor, layer);
  layer.disposables.add(new Disposable(() => this.layers.delete(layer.editor)));
},
```

You never dispose anything yourself: `consumeScrollmapLayer` returns the `Disposable` that unregisters your layer from every editor.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
