const { CompositeDisposable } = require("lumine");

// The strip drawn over an editor's vertical scrollbar.
//
// Rows arrive from the hub's layers as screen rows; turning them into pixels is
// this renderer's own arithmetic, because the whole document is squeezed into
// the height of one scrollbar. The layers never see any of it.
class Scrollmap {
  constructor(editor, registry, filters, visible = true) {
    this.editor = editor;
    this.filters = filters;
    this.destroyed = false;
    this.visible = visible;
    this.canvas = new registry.MarkerCanvas({ className: "scrollmap" });
    this.classNameFor = registry.classNameFor;
    this.element = this.canvas.element;
    this.element.hidden = !visible;
    this.styleSignature = null;
    this.drawSignature = null;
    this.projectedLayers = new WeakMap();
    this.pendingUpdate = null;
    this.domWindow = editor.getElement().ownerDocument.defaultView;

    this.handle = registry.attach(editor);

    // Block decorations move rows down the page without changing which screen
    // row they are, so the pixel positions move and the items do not.
    this.disposables = new CompositeDisposable(
      lumine.scrollbars.observe(editor.getElement(), () => this.updateView()),
      // The document height can change while every layer still contains the
      // same rows. Geometry must follow each edit without waiting for a
      // provider to publish new results or for a decoration to change.
      editor.onDidChange(() => this.updateView()),
      editor.onDidAddDecoration(() => this.updateView()),
      editor.onDidRemoveDecoration(() => this.updateView()),
      editor.onDidUpdateDecorations(() => this.updateView()),
    );
  }

  bindDocument(document) {
    this.pendingUpdate?.dispose();
    this.pendingUpdate = null;
    this.domWindow = document.defaultView;
    this.canvas.invalidate();
    this.styleSignature = this.drawSignature = null;
    this.updateView();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingUpdate?.dispose();
    this.pendingUpdate = null;
    this.disposables.dispose();
    this.handle.dispose();
    this.projectedLayers = new WeakMap();
    this.canvas.destroy();
  }

  update() {
    if (this.destroyed) return;
    this.handle.update();
  }

  updateView() {
    if (this.pendingUpdate || this.destroyed || !this.visible) {
      return;
    }
    // Join the editor and marker hub's frame instead of requesting another
    // animation frame after the items arrive. Paint after all document reads:
    // editor measurements can still change the scrollbar geometry this frame.
    const read = lumine.views.readDocument(() => {
      if (this.pendingUpdate !== read) return;
      const paint = lumine.views.updateDocument(() => {
        if (this.pendingUpdate !== paint) return;
        this.pendingUpdate = null;
        this.drawMarkers();
      });
      this.pendingUpdate = paint;
    });
    this.pendingUpdate = read;
  }

  setVisible(visible) {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    this.element.hidden = !visible;
    if (!visible) {
      this.pendingUpdate?.dispose();
      this.pendingUpdate = null;
      return;
    }
    this.canvas.invalidate();
    this.styleSignature = null;
    this.drawSignature = null;
    this.updateView();
  }

  // The markers resolve their colors from the stylesheets on every draw, but a
  // canvas keeps its last-drawn pixels, so a restyled window needs one more draw
  // to show. Unlike `updateView` this one is synchronous: the theme swap runs
  // inside a View Transition that snapshots the window one frame later, and a
  // canvas only joins the cross-fade if it repaints in the same task.
  updateTheme() {
    if (this.destroyed || !this.visible) return;
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
    // The styles moved, so the identical geometry must repaint anyway.
    this.drawSignature = null;
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
        className: this.classNameFor(layer.props, item),
      });
    }
  }

  drawMarkers() {
    if (this.destroyed || !this.visible || !this.element || !this.editor?.component) {
      return;
    }

    const component = this.editor.component;
    const geometry = lumine.scrollbars.getGeometry(this.editor.getElement());
    const editorHeight = geometry.scrollHeight;
    const lineHeight = component.getLineHeight();
    const clientHeight = geometry.viewportHeight;
    const width = geometry.verticalSize;
    // The core owns the track. Reattach after a scrollbar generation changes,
    // rather than carrying a private sibling with independently measured size.
    const track = lumine.scrollbars.getVerticalTrack(this.editor.getElement());
    if (track && this.element.parentNode !== track) track.appendChild(this.element);
    this.element.style.width = `${width}px`;
    if (editorHeight <= 0 || lineHeight <= 0 || clientHeight <= 0 || width <= 0) {
      return;
    }

    const scale = clientHeight / editorHeight;
    const markerHeight = lineHeight * scale;
    const drawn = [];
    for (const layer of this.handle.layers()) {
      if (layer.limit && layer.items.length > layer.limit * this.filters.scale) {
        continue;
      }
      drawn.push(layer);
    }

    // `did-update-decorations` fires on every cursor blink of a decorated
    // layer, so most calls arrive with nothing to show for it. The items
    // arrays stand in for their content -- the hub swaps one only when the
    // markers actually moved -- and every geometry input that could move a
    // pixel is listed alongside. The row geometry version also covers moving
    // blocks and compensating resizes that leave the total height unchanged.
    const signature = [
      component,
      component.getRowGeometryVersion(),
      editorHeight,
      clientHeight,
      lineHeight,
      width,
      this.domWindow.devicePixelRatio,
    ];
    for (const layer of drawn) {
      signature.push(layer.name, layer.items);
    }
    if (
      this.drawSignature &&
      this.drawSignature.length === signature.length &&
      this.drawSignature.every((value, i) => value === signature[i])
    ) {
      return;
    }
    this.drawSignature = signature;

    const regions = [];
    const projection = [component, component.getRowGeometryVersion(), scale, markerHeight];
    for (const layer of drawn) {
      let cached = this.projectedLayers.get(layer);
      if (
        !cached ||
        cached.items !== layer.items ||
        !cached.projection.every((value, index) => value === projection[index])
      ) {
        const projected = [];
        this.regionsFor(layer, scale, markerHeight, projected);
        cached = { items: layer.items, projection, regions: projected };
        this.projectedLayers.set(layer, cached);
      }
      // A moving cursor invalidates the shared canvas, not the projection of
      // every unchanged diagnostic/search layer beneath it.
      for (const region of cached.regions) regions.push(region);
    }
    this.canvas.draw(regions, width, clientHeight);
  }
}

module.exports = Scrollmap;
