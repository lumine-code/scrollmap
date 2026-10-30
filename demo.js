// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
const readbacks = new WeakMap();

function hasVisibleCanvasPixels(canvas) {
  if (!canvas?.isConnected || !canvas.width || !canvas.height) return false;
  const window = canvas.ownerDocument.defaultView;
  const bounds = canvas.getBoundingClientRect();
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.right <= 0 ||
    bounds.bottom <= 0 ||
    bounds.left >= window.innerWidth ||
    bounds.top >= window.innerHeight
  )
    return false;
  for (let element = canvas; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0)
      return false;
  }
  let readback = readbacks.get(canvas);
  if (!readback) {
    const element = canvas.ownerDocument.createElement("canvas");
    readback = { element, context: element.getContext("2d", { willReadFrequently: true }) };
    readbacks.set(canvas, readback);
  }
  if (readback.element.width !== canvas.width) readback.element.width = canvas.width;
  if (readback.element.height !== canvas.height) readback.element.height = canvas.height;
  readback.context.clearRect(0, 0, canvas.width, canvas.height);
  readback.context.drawImage(canvas, 0, 0);
  const { data } = readback.context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 3; offset < data.length; offset += 4) if (data[offset] > 0) return true;
  return false;
}

module.exports = {
  version: 1,
  dependencies: ["language-gfm", "navigation-panel", "marker"],
  viewport: { width: 1100, height: 730 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("navigation/README.md");
    await lumine.project.setPaths([fixture("navigation")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Locate document sections on the scrollbar while navigating a long file.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "navigation-panel:open");
        }
      },
      ready({ state }) {
        const strip = state.editor.getElement().querySelector(".scrollmap");
        return Boolean(
          strip?.querySelector(".marker-navigation.scrollmap-style-probe") &&
          hasVisibleCanvasPixels(strip.querySelector("canvas.scrollmap-canvas")),
        );
      },
    },
  ],
  async cleanup() {},
};
