/** @babel */
/** @jsx etch.dom */

const etch = require("etch");
etch.setScheduler(atom.views);
const { CompositeDisposable } = require("atom");
const { drawMarkerRegions } = require("./markers");
const { throttles } = require("./utils");

class Scrollmap {
  constructor(editor) {
    this.editor = editor;
    this.layers = new Map();
    this.disabledLayers = atom.config.get("scrollmap.disabledLayers") || [];
    [this.update, this.refresh] = throttles(
      () => this.updateLayers(),
      () => this.refreshLayers(),
      20,
    );
    this.disposables = new CompositeDisposable(
      this.editor.onDidAddDecoration(this.refresh),
      this.editor.onDidRemoveDecoration(this.refresh),
      this.editor.onDidUpdateDecorations(this.refresh),
      this.editor.displayLayer.foldsMarkerLayer.onDidUpdate(this.update),
      atom.config.onDidChange("scrollmap.disabledLayers", ({ newValue }) => {
        this.disabledLayers = newValue || [];
        this.updateView();
      }),
    );
    etch.initialize(this);
  }

  destroy() {
    this.disposables.dispose();
    for (let layer of this.layers.values()) {
      layer.destroy();
    }
    this.layers.clear();
    etch.destroy(this);
  }

  addLayer(name, props) {
    if (this.layers.has(name)) {
      return;
    }
    const Layer = require("./layer");
    const layer = new Layer(this.editor, props);
    this.layers.set(name, layer);
  }

  delLayer(name) {
    if (!this.layers.has(name)) {
      return;
    }
    const layer = this.layers.get(name);
    layer.destroy();
    this.layers.delete(name);
  }

  render() {
    if (!this.editor || !this.editor.component) {
      return (
        <div class="scrollmap">
          <canvas class="scrollmap-canvas" />
          <div class="scrollmap-style-resolver" />
        </div>
      );
    }
    return (
      <div class="scrollmap">
        <canvas class="scrollmap-canvas" />
        <div class="scrollmap-style-resolver" />
      </div>
    );
  }

  updateView() {
    etch.update(this).then(() => this.drawMarkers());
  }

  updateLayers() {
    this.layers.forEach((layer) => {
      layer.update();
    });
  }

  refreshLayers() {
    this.layers.forEach((layer) => {
      layer.refresh();
    });
  }

  drawMarkers() {
    if (!this.element || !this.editor?.component) {
      return;
    }

    const canvas = this.element.querySelector(".scrollmap-canvas");
    if (!canvas) {
      return;
    }

    const editorHeight = this.editor.component.getScrollHeight();
    const lineHeight = this.editor.component.getLineHeight();
    const clientHeight = this.editor.component.getScrollContainerClientHeight();
    const width = this.element.clientWidth;
    if (editorHeight <= 0 || lineHeight <= 0 || clientHeight <= 0 || width <= 0) {
      return;
    }

    const scale = clientHeight / editorHeight;
    const markerHeight = lineHeight * scale;
    const regions = [];
    for (let [name, layer] of this.layers) {
      if (this.disabledLayers.includes(name)) {
        continue;
      }
      for (const item of layer.items) {
        let y = item.pix * scale;
        let height = markerHeight;
        if (item.piz !== undefined) {
          y = Math.min(item.pix, item.piz) * scale;
          height = Math.abs(item.piz - item.pix) * scale + markerHeight;
        }
        regions.push({
          y,
          height,
          className: item.className,
        });
      }
    }

    drawMarkerRegions(canvas, this.element, regions, width, clientHeight);
  }
}

module.exports = Scrollmap;
