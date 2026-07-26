# scrollmap.widget

The `Simplemap` class, so a package can draw scrollbar markers beside a pane that is not a text editor.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideScrollmapWidget()` returning the class itself   |
| Consumed by | `consumeScrollmapWidget(Simplemap)`                     |
| Owner       | [`scrollmap`](https://github.com/lumine-code/scrollmap) |

Editor panes get their markers from [`scrollmap.layer`](scrollmap.layer.md); this service exists for everything else — a PDF page, a notebook, a rendered preview — where there is no `TextEditor` and no screen row to anchor to. Positions are percentages of the pane's height instead.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "scrollmap.widget": {
      "versions": { "^1.0.0": "consumeScrollmapWidget" }
    }
  }
}
```

The service **is** the class, not an instance and not a factory. Construct it yourself, once per view that needs a scrollbar.

## Contract

```ts
class Simplemap {
  constructor();
  element: HTMLElement;
  setItems(items: Item[]): void;
  update(): void;
  destroy(): void;
}

type Item = {
  prc: number;
  end?: number;
  height?: number | string;
  cls?: string;
  position?: "left" | "right" | "full";
};
```

| Member            | Description                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `element`         | The widget's root element. Append it to your own container; the widget never places itself. |
| `setItems(items)` | Replaces the marker set and repaints.                                                       |
| `update()`        | Repaints the current items, for when the container has been resized.                        |
| `destroy()`       | Drops the theme subscriptions and removes `element` from the DOM.                           |

An item:

| Field      | Type                              | Description                                                                                     |
| ---------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `prc`      | number                            | Marker offset as a percentage of the container height, `0`–`100`. Required.                     |
| `end`      | number                            | End of the range, also a percentage. The marker spans `prc`–`end`.                              |
| `height`   | number \| string                  | Fixed height for a single marker, as a pixel number or a CSS length. Ignored when `end` is set. |
| `cls`      | string                            | Extra CSS class, appended after `marker`.                                                       |
| `position` | `"left"` \| `"right"` \| `"full"` | Column for this item.                                                                           |

## Minimal example

```js
const { Disposable } = require("atom");

module.exports = {
  consumeScrollmapWidget(Simplemap) {
    this.simplemap = new Simplemap();
    this.container.appendChild(this.simplemap.element);
    this.simplemap.setItems([
      { prc: 10, cls: "marker-h1" },
      { prc: 50, end: 60, cls: "marker-h2" },
    ]);
    return new Disposable(() => {
      this.simplemap.destroy();
      this.simplemap = null;
    });
  },
};
```

## Behavior

Markers are drawn on a canvas, but their appearance still comes from CSS: the widget resolves `.marker` rules through a hidden style-resolver element, so the same rules that style editor layers style these too.

The widget subscribes to theme and stylesheet changes and repaints itself when the marker styles actually change, so a theme switch needs no work from the consumer. A container **resize** is not observed — call `update()` when your view changes size.

Nothing is drawn while the container measures zero in either dimension, so appending `element` to a hidden container and setting items is safe; call `update()` once it becomes visible.

## Teardown

Call `destroy()` when your view goes away, from the `Disposable` you return from `consumeScrollmapWidget`. It disposes the theme subscriptions and removes `element`. Destroying the widget does not clear your own reference — drop it yourself, as above.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
