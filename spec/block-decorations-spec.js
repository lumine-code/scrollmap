const path = require("node:path");

const MARKER_PATH = path.join(__dirname, "..", "..", "marker");
const SCROLLMAP_PATH = path.join(__dirname, "..");
const TARGET_ROW = 12;

describe("scrollmap block decoration geometry", () => {
  let editor, editorElement, strip, draw, registration, style, markers, previousPaint, activeSpec;

  function requireActive(spec) {
    if (activeSpec !== spec || !spec?.active) {
      throw new Error("Block geometry work outlived its spec");
    }
  }

  function waitFor(condition) {
    const spec = activeSpec;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        try {
          requireActive(spec);
          const result = condition();
          if (result) {
            resolve(result);
          } else {
            const elapsed = performance.now() - started;
            if (++attempts >= 120 || elapsed >= 2000) {
              reject(
                new Error(
                  `Block geometry was not ready after ${Math.round(elapsed)} ms (${attempts} frames)`,
                ),
              );
            } else requestAnimationFrame(check);
          }
        } catch (error) {
          reject(error);
        }
      };
      check();
    });
  }

  async function settle() {
    const spec = activeSpec;
    for (let frame = 0; frame < 3; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      requireActive(spec);
    }
  }

  function paints() {
    return draw.calls.all().filter((call) => call.object === strip.canvas);
  }

  function lastPaint() {
    previousPaint = paints().at(-1) ?? previousPaint;
    return previousPaint;
  }

  function region() {
    return lastPaint()?.args[0].find((item) => item.className.includes("marker-block-spec"));
  }

  function rowTop() {
    return editorElement.pixelPositionForScreenPosition([TARGET_ROW, 0]).top;
  }

  function block(row, height, position = "before") {
    const marker = editor.markBufferPosition([row, 0], { invalidate: "never" });
    markers.push(marker);
    const item = document.createElement("div");
    item.style.cssText = `height: ${height}px; width: 30px; margin: 0; padding: 0; border: 0;`;
    const decoration = editor.decorateMarker(marker, { type: "block", position, item });
    return { marker, item, decoration };
  }

  async function measured() {
    await settle();
    await waitFor(() => region());
    const before = {
      top: rowTop(),
      height: editorElement.getScrollHeight(),
      items: strip.handle.layerFor("block-spec").items,
      region: { ...region() },
    };
    draw.calls.reset();
    return before;
  }

  function expectRepaint(before, sameHeight = true) {
    expect(paints().length).toBeGreaterThan(0);
    expect(strip.handle.layerFor("block-spec").items).toBe(before.items);
    if (sameHeight) expect(editorElement.getScrollHeight()).toBeCloseTo(before.height, 3);
    const latest = region();
    if (!latest) return;
    const canvasHeight = lastPaint().args[2];
    expect(latest.y).toBeCloseTo((rowTop() / editorElement.getScrollHeight()) * canvasHeight, 3);
    expect(Math.abs(latest.y - before.region.y)).toBeGreaterThan(0.1);
  }

  beforeEach(async () => {
    activeSpec = { active: true };
    const workspaceElement = lumine.views.getView(lumine.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);
    lumine.config.set("editor.scrollPastEnd", false);
    lumine.config.set("marker.cursors.enabled", false);
    lumine.config.set("scrollmap.overlayWidth", 8);
    style = document.createElement("style");
    style.textContent = ".marker.marker-block-spec { background-color: rgb(0, 128, 255); }";
    document.head.appendChild(style);
    markers = [];
    previousPaint = null;

    const markerPack = await lumine.packages.activatePackage(MARKER_PATH);
    const markerMain = markerPack.mainModule;
    registration = markerMain.consumeMarkerLayer({
      name: "block-spec",
      getItems: () => [{ row: TARGET_ROW }],
    });
    const registry = markerMain.provideMarkerRegistry();
    draw = spyOn(registry.MarkerCanvas.prototype, "draw").and.callThrough();
    editor = await lumine.workspace.open();
    editor.setText(Array(80).fill("block geometry").join("\n"));
    editorElement = editor.getElement();
    const scrollmapPack = await lumine.packages.activatePackage(SCROLLMAP_PATH);
    strip = await waitFor(() => scrollmapPack.mainModule.scrollmapForEditor(editor));
    await waitFor(() => region());
    await settle();
  });

  afterEach(() => {
    activeSpec.active = false;
    for (const marker of markers) marker.destroy();
    registration?.dispose();
    style?.remove();
  });

  it("repaints when a block crosses a fixed marker without changing document height", async () => {
    const originalTop = rowTop();
    const source = block(2, 80);
    await waitFor(() => rowTop() > originalTop + 79);
    const before = await measured();

    source.marker.setHeadBufferPosition([20, 0]);
    await waitFor(() => rowTop() < before.top - 79);
    await settle();

    expectRepaint(before);
  });

  it("repaints when same-height blocks are removed and added elsewhere in one task", async () => {
    const originalTop = rowTop();
    const source = block(2, 80);
    await waitFor(() => rowTop() > originalTop + 79);
    const before = await measured();

    source.decoration.destroy();
    block(20, 80);
    await waitFor(() => rowTop() < before.top - 79);
    await settle();

    expectRepaint(before);
  });

  it("repaints compensating block resizes while the total document height stays fixed", async () => {
    const originalTop = rowTop();
    const above = block(2, 40);
    const below = block(20, 80);
    await waitFor(() => rowTop() > originalTop + 39 && below.item.isConnected);
    const before = await measured();

    above.item.style.height = "80px";
    below.item.style.height = "40px";
    await waitFor(
      () =>
        rowTop() > before.top + 39 &&
        Math.abs(editorElement.getScrollHeight() - before.height) < 0.1,
    );
    await settle();

    expectRepaint(before);
  });

  it("follows a block position property change across its anchor row", async () => {
    const originalTop = rowTop();
    const source = block(TARGET_ROW, 80, "before");
    await waitFor(() => rowTop() > originalTop + 79);
    const before = await measured();

    source.decoration.setProperties({ type: "block", position: "after", item: source.item });
    await waitFor(() => rowTop() < before.top - 79);
    await settle();

    expectRepaint(before);
  });

  it("follows a replacement block item and its later resize", async () => {
    const originalTop = rowTop();
    const source = block(2, 40);
    await waitFor(() => rowTop() > originalTop + 39);
    await measured();
    const replacement = document.createElement("div");
    replacement.style.cssText = "height: 40px; width: 30px; margin: 0; padding: 0; border: 0;";
    source.decoration.setProperties({ type: "block", position: "before", item: replacement });
    await waitFor(() => replacement.isConnected && !source.item.isConnected);
    const before = await measured();

    replacement.style.height = "80px";
    await waitFor(() => rowTop() > before.top + 39);
    await settle();

    expectRepaint(before, false);
    draw.calls.reset();
    source.item.style.height = "200px";
    await settle();
    expect(paints()).toEqual([]);
  });

  it("updates geometry when an existing decoration enters and leaves the block type", async () => {
    const marker = editor.markBufferPosition([2, 0], { invalidate: "never" });
    markers.push(marker);
    const decoration = editor.decorateMarker(marker, { type: "line", class: "block-type-spec" });
    const item = document.createElement("div");
    item.style.cssText = "height: 80px; width: 30px; margin: 0; padding: 0; border: 0;";
    const before = await measured();

    decoration.setProperties({ type: "block", position: "before", item });
    await waitFor(() => rowTop() > before.top + 79);
    await settle();
    expectRepaint(before, false);
    const withBlock = await measured();

    decoration.setProperties({ type: "line", class: "block-type-spec" });
    await waitFor(() => rowTop() < withBlock.top - 79);
    await settle();
    expectRepaint(withBlock, false);
  });

  it("keeps cursor and unchanged non-block decoration updates free of repaints", async () => {
    const originalTop = rowTop();
    block(2, 80);
    await waitFor(() => rowTop() > originalTop + 79);
    const marker = editor.markBufferPosition([4, 0]);
    markers.push(marker);
    const decoration = editor.decorateMarker(marker, { type: "line", class: "first" });
    const before = await measured();

    editor.setCursorBufferPosition([3, 2]);
    decoration.setProperties({ type: "line", class: "second" });
    decoration.setProperties({ type: "line", class: "second" });
    await settle();

    expect(rowTop()).toBeCloseTo(before.top, 3);
    expect(editorElement.getScrollHeight()).toBeCloseTo(before.height, 3);
    expect(strip.handle.layerFor("block-spec").items).toBe(before.items);
    expect(paints()).toEqual([]);
  });

  it("cancels pending block repaints and ignores later geometry after deactivation", async () => {
    const originalTop = rowTop();
    const source = block(2, 80);
    await waitFor(() => rowTop() > originalTop + 79);
    await measured();

    source.marker.setHeadBufferPosition([20, 0]);
    await lumine.packages.deactivatePackage("scrollmap");
    source.marker.setHeadBufferPosition([3, 0]);
    source.item.style.height = "120px";
    await settle();

    expect(paints()).toEqual([]);
    expect(editorElement.contains(strip.element)).toBe(false);
  });
});
