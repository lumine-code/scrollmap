const { CompositeDisposable } = require("atom");
const { coalesce } = require("@lumine-code/marker-host");
const { MarkerCanvas, resolveLength } = require("@lumine-code/marker-host/canvas");

// The same strip, for a pane that is not a text editor.
//
// A PDF page or a notebook has no screen rows, so items arrive as percentages of
// the document and the caller sets them directly. Everything else -- the marker
// classes, the style probe, the z-index ordering -- is shared with the editor
// strip, so one stylesheet styles both.
class Simplemap {
  constructor() {
    this.items = [];
    this.canvas = new MarkerCanvas({
      className: "simplemap",
      canvasClass: "scrollmap-canvas",
      resolverClass: "scrollmap-style-resolver",
      probeClass: "scrollmap-style-probe",
    });
    this.element = this.canvas.element;
    this.styleSignature = null;

    const updateTheme = coalesce(() => this.updateTheme());
    this.disposables = new CompositeDisposable(
      atom.styles.onDidAddStyleElement(updateTheme),
      atom.themes.onDidChangeActiveThemes(updateTheme),
    );
  }

  setItems(items) {
    this.items = items;
    this.drawMarkers();
  }

  update() {
    this.canvas.invalidate();
    this.drawMarkers();
  }

  // Repaint a restyled window from within its cross-fade, and only when the
  // restyle reached the markers. See `Scrollmap.updateTheme`.
  updateTheme() {
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

  destroy() {
    this.disposables.dispose();
    this.canvas.destroy();
  }

  drawMarkers() {
    if (!this.element) {
      return;
    }

    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    const regions = this.items.map((item) => {
      let className = "marker";
      if (item.position) {
        className += ` ${item.position}`;
      }
      if (item.cls) {
        className += ` ${item.cls}`;
      }
      let markerHeight = 0;
      if (item.end !== undefined) {
        markerHeight = ((item.end - item.prc) / 100) * height;
      } else if (item.height) {
        markerHeight = resolveLength(item.height, height);
      }
      return {
        y: (item.prc / 100) * height,
        height: markerHeight,
        className,
      };
    });

    this.canvas.draw(regions, width, height);
  }
}

module.exports = Simplemap;
