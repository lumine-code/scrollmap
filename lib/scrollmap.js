const { CompositeDisposable } = require("atom");
const { classNameFor } = require("@lumine-code/marker-host");
const { MarkerCanvas } = require("@lumine-code/marker-host/canvas");

// The strip drawn over an editor's vertical scrollbar.
//
// Rows arrive from the layers as screen rows; turning them into pixels is this
// renderer's own arithmetic, because the whole document is squeezed into the
// height of one scrollbar. The layers never see any of it.
class Scrollmap {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.destroyed = false;
    this.canvas = new MarkerCanvas({ className: "scrollmap" });
    this.element = this.canvas.element;
    this.styleSignature = null;
    this.rafId = null;

    this.set = host.attach(editor);

    // Block decorations move rows down the page without changing which screen
    // row they are, so the pixel positions move and the items do not.
    this.disposables = new CompositeDisposable(
      editor.onDidAddDecoration(() => this.updateView()),
      editor.onDidRemoveDecoration(() => this.updateView()),
      editor.onDidUpdateDecorations(() => this.updateView()),
    );
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.disposables.dispose();
    this.host.detach(this.editor);
    this.canvas.destroy();
  }

  update() {
    this.set.update();
  }

  updateView() {
    if (this.rafId || this.destroyed) {
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
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    const signature = this.canvas.signature(width, height);
    if (signature === this.styleSignature) {
      return;
    }
    this.styleSignature = signature;
    this.canvas.invalidate();
    this.drawMarkers();
  }

  // The renderer's half of what `prepareItems` used to do, as a projection
  // rather than a mutation: two renderers read these items, so neither may
  // write to them.
  regionsFor(layer, scale, markerHeight, regions) {
    const { component } = this.editor;
    for (const item of layer.items) {
      const pix = component.pixelPositionAfterBlocksForRow(item.row);
      const piz =
        item.end !== undefined && item.end !== item.row
          ? component.pixelPositionAfterBlocksForRow(item.end)
          : undefined;

      regions.push({
        y: piz === undefined ? pix * scale : Math.min(pix, piz) * scale,
        height: piz === undefined ? markerHeight : Math.abs(piz - pix) * scale + markerHeight,
        className: classNameFor(layer.props, item),
      });
    }
  }

  drawMarkers() {
    if (this.destroyed || !this.element || !this.editor?.component) {
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
    for (const layer of this.set.enabled()) {
      this.regionsFor(layer, scale, markerHeight, regions);
    }

    this.canvas.draw(regions, width, clientHeight);
  }
}

module.exports = Scrollmap;
