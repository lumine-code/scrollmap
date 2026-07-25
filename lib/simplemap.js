const { drawMarkerRegions, resolveLength } = require("./markers");

class Simplemap {
  constructor() {
    this.items = [];
    this.element = this.createElement();
  }

  setItems(items) {
    this.items = items;
    this.drawMarkers();
  }

  createElement() {
    const element = document.createElement("div");
    element.className = "simplemap";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "scrollmap-canvas";
    element.appendChild(this.canvas);

    this.styleResolver = document.createElement("div");
    this.styleResolver.className = "scrollmap-style-resolver";
    element.appendChild(this.styleResolver);

    return element;
  }

  update() {
    this.drawMarkers();
  }

  destroy() {
    this.element.remove();
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

    drawMarkerRegions(this.canvas, this.element, regions, width, height);
  }
}

module.exports = Simplemap;
