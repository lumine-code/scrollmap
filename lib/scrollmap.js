const { CompositeDisposable } = require("atom");
const { drawMarkerRegions, getStyleSignature } = require("./markers");
const { throttles } = require("./utils");

class Scrollmap {
  constructor(editor) {
    this.editor = editor;
    this.destroyed = false;
    this.layers = new Map();
    this.disabledLayers = atom.config.get("scrollmap.disabledLayers") || [];
    this.throttled = throttles(
      () => this.updateLayers(),
      () => this.refreshLayers(),
      20,
    );
    [this.update, this.refresh] = this.throttled;
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
    this.element = this.createElement();
    this.styleSignature = null;
    this.rafId = null;
  }

  destroy() {
    this.destroyed = true;
    this.throttled.cancel();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.disposables.dispose();
    for (let layer of this.layers.values()) {
      layer.destroy();
    }
    this.layers.clear();
    this.element.remove();
  }

  addLayer(name, props) {
    if (this.layers.has(name)) {
      return;
    }
    const Layer = require("./layer");
    const layer = new Layer(this.editor, props, this);
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

  createElement() {
    const element = document.createElement("div");
    element.className = "scrollmap";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "scrollmap-canvas";
    element.appendChild(this.canvas);

    this.styleResolver = document.createElement("div");
    this.styleResolver.className = "scrollmap-style-resolver";
    element.appendChild(this.styleResolver);

    return element;
  }

  updateView() {
    if (this.rafId) {
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.drawMarkers();
    });
  }

  // The markers resolve their colors from the stylesheets on every draw, but a
  // canvas keeps its last-drawn pixels, so a restyled window needs one more draw
  // to show. Unlike `updateView` this one is synchronous: the theme swap runs
  // inside a View Transition that snapshots the window one frame later, and a
  // canvas only joins the cross-fade if it repaints in the same task.
  updateTheme() {
    // The signal behind this is every stylesheet attached to the window, at any
    // time, and hardly any of them touch the markers -- so pay for the layout
    // read and the canvas rewrite only when the styles really moved.
    const signature = getStyleSignature(this.element);
    if (signature === this.styleSignature) {
      return;
    }
    this.styleSignature = signature;
    this.drawMarkers();
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

    drawMarkerRegions(this.canvas, this.element, regions, width, clientHeight);
  }
}

module.exports = Scrollmap;
