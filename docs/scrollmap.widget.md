# scrollmap.widget

The `Simplemap` class, so a package can draw scrollbar markers beside a pane that is not a text editor.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideScrollmapWidget()` returning the class itself   |
| Consumed by | `consumeScrollmapWidget(Simplemap)`                     |
| Owner       | [`scrollmap`](https://github.com/lumine-code/scrollmap) |

Editor panes get their markers from [`marker.layer`](https://github.com/lumine-code/marker/blob/master/docs/marker.layer.md); this service exists for everything else — a PDF page, a notebook, a rendered preview — where there is no `TextEditor` and no screen row to anchor to. Positions are percentages of the pane's height instead.

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

The service **is** the class, not an instance and not a factory. Construct it yourself, once per view that needs scrollbar markers. Bind its scroll element to share the core's existing scrollbar; the widget does not create another scroll controller.

## Contract

```ts
class Simplemap {
  constructor(options?: { scrollElement?: HTMLElement });
  element: HTMLElement;
  setScrollElement(element: HTMLElement | null): void;
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

| Member                      | Description                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `element`                   | The widget's root element; a bound widget mounts itself in the shared track, while a standalone widget needs a caller-owned container.                |
| `setScrollElement(element)` | Binds to a core scroll surface, mounting the markers inside its vertical track and observing local geometry; `null` unbinds and detaches the markers. |
| `setItems(items)`           | Replaces markers and paints changed data or geometry; identical pixels skip the redraw.                                                               |
| `update()`                  | Repaints the current items, for when the container has been resized.                                                                                  |
| `destroy()`                 | Drops the theme subscriptions and removes `element` from the DOM.                                                                                     |

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
const { Disposable } = require("lumine");

module.exports = {
  consumeScrollmapWidget(Simplemap) {
    this.simplemap = new Simplemap({ scrollElement: this.container });
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

Markers are drawn on a canvas, but their appearance still comes from CSS: the widget resolves `.marker` rules through a hidden style-resolver element — the same canvas machinery the `marker` package supplies to every overview map — so the rules that style editor layers style these too. Without the `marker` package installed the widget degrades to an empty strip.

The widget subscribes to theme and stylesheet changes and repaints itself when the marker styles actually change, so a theme switch needs no work from the consumer. A bound widget observes `lumine.scrollbars` geometry for its own scroll element, coalesces item and geometry updates in the shared document read/paint cycle, and paints above the thumb. Scroll movement alone does not rebuild its markers. Repeated identical item sets skip canvas work. Markers never intercept clicks; the core track owns pointer interaction.

An unbound widget retains the standalone rectangle API: append `element` to your own container, set its dimensions, and call `update()` after a resize without fresh items. Its `setItems()` paints synchronously. Bound widgets mount themselves, so consumers must not move them back into their content container.

Nothing is drawn while the track measures zero in either dimension. Bound widgets resume when the core reports changed geometry; standalone widgets need `update()` once their container becomes visible.

## Teardown

Call `destroy()` when your view goes away, from the `Disposable` you return from `consumeScrollmapWidget`. It disposes the theme and geometry subscriptions, cancels queued work and removes `element`. Destroying the widget does not clear your own reference — drop it yourself, as above.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
