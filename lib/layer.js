const { CompositeDisposable } = require("atom");
const { throttles } = require("./utils");

class Layer {
  constructor(editor, props) {
    this.editor = editor;
    this.props = props;
    this.cache = new Map();
    this.items = [];
    this.disposables = new CompositeDisposable();
    [this.update, this.refresh] = throttles(
      () => this.updateSync(),
      () => this.refreshSync(),
      this.props.timer ?? 20,
    );
    if ("initialize" in this.props) {
      this.props.initialize(this);
    }
  }

  updateSync() {
    if (!this.editor.scrollmap) {
      return;
    }
    if (!this.editor.component) {
      return;
    }
    if ("getItems" in this.props) {
      const items = this.props.getItems(this);
      if (items) {
        this.items = items;
      }
    }
    this.refreshSync();
  }

  refreshSync() {
    this.prepareItems();
    this.editor.scrollmap.updateView();
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
      if (this.props.position) {
        item.className += ` ${this.props.position}`;
      }
      if (item.cls) {
        item.className += ` ${item.cls}`;
      }
    }
  }

  destroy() {
    this.cache.clear();
    this.items = [];
    this.disposables.dispose();
  }
}

module.exports = Layer;
