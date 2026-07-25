const { CompositeDisposable } = require("atom");
const { throttles } = require("./utils");

// Sort by document position and merge items on adjacent rows that share
// the same cls and position, so providers can return raw ranges.
function mergeItems(items) {
  items.sort(
    (a, b) =>
      a.row - b.row ||
      (a.end ?? a.row) - (b.end ?? b.row) ||
      (a.cls ?? "").localeCompare(b.cls ?? ""),
  );
  const merged = [];
  let lastItem = null;
  for (const item of items) {
    if (
      lastItem &&
      (item.cls ?? "") === (lastItem.cls ?? "") &&
      (item.position ?? "") === (lastItem.position ?? "") &&
      item.row <= (lastItem.end ?? lastItem.row) + 1
    ) {
      lastItem.end = Math.max(lastItem.end ?? lastItem.row, item.end ?? item.row);
    } else {
      if (lastItem) merged.push(lastItem);
      lastItem = item;
    }
  }
  if (lastItem) merged.push(lastItem);
  return merged;
}

class Layer {
  constructor(editor, props, scrollmap) {
    this.editor = editor;
    this.props = props;
    this.scrollmap = scrollmap;
    this.cache = new Map();
    this.items = [];
    this.disposables = new CompositeDisposable();
    this.throttled = throttles(
      () => this.updateSync(),
      () => this.refreshSync(),
      this.props.timer ?? 20,
    );
    [this.update, this.refresh] = this.throttled;
    if (this.props.threshold) {
      this.disposables.add(atom.config.onDidChange(this.props.threshold, this.update));
    }
    if ("initialize" in this.props) {
      this.props.initialize(this);
    }
  }

  updateSync() {
    if (this.scrollmap.destroyed) {
      return;
    }
    if (!this.editor.component) {
      return;
    }
    if ("getItems" in this.props) {
      let items = this.props.getItems(this);
      if (items) {
        items = items.map((item) => ({ ...item }));
        if (this.props.merge) {
          items = mergeItems(items);
        }
        if (this.props.threshold) {
          const limit = atom.config.get(this.props.threshold);
          if (limit && items.length > limit) {
            items = [];
          }
        }
        this.items = items;
      }
    }
    this.refreshSync();
  }

  refreshSync() {
    if (this.scrollmap.destroyed || !this.editor.component) {
      return;
    }
    this.prepareItems();
    this.scrollmap.updateView();
  }

  // calculate pixel position based on screen position
  prepareItems() {
    for (let item of this.items) {
      item.pix = this.editor.component.pixelPositionAfterBlocksForRow(item.row);
      delete item.piz;
      if (item.end !== undefined && item.end !== item.row) {
        item.piz = this.editor.component.pixelPositionAfterBlocksForRow(item.end);
      }
      item.className = `marker marker-${this.props.name}`;
      const position = item.position ?? this.props.position;
      if (position) {
        item.className += ` ${position}`;
      }
      if (item.cls) {
        item.className += ` ${item.cls}`;
      }
    }
  }

  destroy() {
    this.throttled.cancel();
    this.cache.clear();
    this.items = [];
    this.disposables.dispose();
  }
}

module.exports = Layer;
