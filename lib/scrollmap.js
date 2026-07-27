const { CompositeDisposable } = require("atom");
const toolkit = require("./toolkit");

// What the strip is worth where the platform's own scrollbar reserves no space.
// Drawn over the right edge of the text, which is what an overlay scrollbar
// does too, so the two occupy the same band rather than competing for it.
function overlayWidth() {
  return atom.config.get("scrollmap.overlayWidth") ?? 0;
}

// The strip drawn over an editor's vertical scrollbar.
//
// Rows arrive from the hub's layers as screen rows; turning them into pixels is
// this renderer's own arithmetic, because the whole document is squeezed into
// the height of one scrollbar. The layers never see any of it.
class Scrollmap {
  constructor(editor, registry, filters) {
    this.editor = editor;
    this.filters = filters;
    this.destroyed = false;
    this.canvas = new toolkit.MarkerCanvas({ className: "scrollmap" });
    this.element = this.canvas.element;
    this.styleSignature = null;
    this.rafId = null;

    this.handle = registry.attach(editor);

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
    this.handle.dispose();
    this.canvas.destroy();
  }

  update() {
    this.handle.update();
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

  // The renderer's half of the pixel math, as a projection rather than a
  // mutation: every renderer reads the same items, so none may write to them.
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
        className: toolkit.classNameFor(layer.props, item),
      });
    }
  }

  drawMarkers() {
    if (this.destroyed || !this.element || !this.editor?.component) {
      return;
    }

    const component = this.editor.component;
    const editorHeight = component.getScrollHeight();
    const lineHeight = component.getLineHeight();
    const clientHeight = component.getScrollContainerClientHeight();
    // Asked of the component rather than measured off the strip: the component
    // measures its scrollbar with `overflow: scroll` forced, so this is the real
    // width even for an editor whose content fits and shows no scrollbar. The
    // strip used to take its width from a CSS variable measured off a live
    // scrollbar, which is 0 in exactly that case -- so opening a short file
    // first left every marker invisible until a long one came along.
    //
    // Zero is also the honest answer on a platform whose scrollbars float over
    // the content, and there the strip has to float too, at a width of its own.
    const width = component.getVerticalScrollbarWidth() || overlayWidth();
    if (editorHeight <= 0 || lineHeight <= 0 || clientHeight <= 0 || width <= 0) {
      return;
    }
    this.element.style.width = `${width}px`;

    const scale = clientHeight / editorHeight;
    const markerHeight = lineHeight * scale;
    const regions = [];
    for (const layer of this.handle.layers()) {
      // The hub keeps every layer's items; showing them is this strip's call.
      if (this.filters.disabled.includes(layer.name)) {
        continue;
      }
      if (layer.limit && layer.items.length > layer.limit * this.filters.scale) {
        continue;
      }
      this.regionsFor(layer, scale, markerHeight, regions);
    }

    this.canvas.draw(regions, width, clientHeight);
  }
}

module.exports = Scrollmap;
