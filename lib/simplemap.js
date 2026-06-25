/** @babel */
/** @jsx etch.dom */

const etch = require("etch");
etch.setScheduler(atom.views);
const { drawMarkerRegions, resolveLength } = require("./markers");

class Simplemap {
  constructor() {
    this.items = [];
    etch.initialize(this);
  }

  setItems(items) {
    this.items = items;
    etch.update(this).then(() => this.drawMarkers());
  }

  render() {
    return (
      <div class="simplemap">
        <canvas class="scrollmap-canvas" />
        <div class="scrollmap-style-resolver" />
      </div>
    );
  }

  update() {
    return etch.update(this).then(() => this.drawMarkers());
  }

  destroy() {
    etch.destroy(this);
  }

  drawMarkers() {
    if (!this.element) {
      return;
    }

    const canvas = this.element.querySelector(".scrollmap-canvas");
    if (!canvas) {
      return;
    }

    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    const regions = this.items.map((item) => {
      const className = item.cls ? `marker ${item.cls}` : "marker";
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

    drawMarkerRegions(canvas, this.element, regions, width, height);
  }
}

module.exports = Simplemap;
