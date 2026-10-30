describe("scrollmap frame scheduling", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, marker, editor, strip, layer, row, reads, writes;

  function drain(queue, { includeCancelled = false } = {}) {
    while (queue.length) {
      const job = queue.shift();
      if (!job.cancelled || includeCancelled) job.callback();
    }
  }

  function frame() {
    drain(writes);
    drain(reads);
    drain(writes);
  }

  beforeEach(async () => {
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "600px";
    jasmine.attachToDOM(workspace);
    lumine.config.set("marker.cursors.enabled", false);
    marker = (await lumine.packages.activatePackage("marker")).mainModule;
    main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("marker row\n".repeat(100));
    await conditionPromise(() => !!main.scrollmapForEditor(editor));
    strip = main.scrollmapForEditor(editor);
    row = 1;
    marker.consumeMarkerLayer({ name: "frame-test", getItems: () => [{ row }] });
    strip.handle.updateSync();
    lumine.views.performDocumentUpdate();

    reads = [];
    writes = [];
    const { Disposable } = require("lumine");
    for (const [method, queue] of [
      ["readDocument", reads],
      ["updateDocument", writes],
    ]) {
      spyOn(lumine.views, method).and.callFake((callback) => {
        const job = { callback, cancelled: false };
        queue.push(job);
        return new Disposable(() => (job.cancelled = true));
      });
    }
    layer = strip.handle.layerFor("frame-test");
  });

  it("paints the newest provider data once in the frame that computes it", () => {
    const draw = spyOn(strip.canvas, "draw").and.callThrough();
    // Decoration invalidation can precede the provider's new data.
    strip.updateView();
    row = 20;
    layer.update();
    row = 40;
    layer.update();

    frame();

    expect(layer.items).toEqual([{ row: 40 }]);
    expect(draw).toHaveBeenCalledTimes(1);
    const expectedY =
      (editor.component.pixelPositionAfterBlocksForRow(40) *
        editor.component.getScrollContainerClientHeight()) /
      editor.component.getScrollHeight();
    expect(draw.calls.mostRecent().args[0][0].y).toBeCloseTo(expectedY);
    expect(strip.pendingUpdate).toBeNull();
  });

  it("tracks continuous Enter edits without provider or decoration updates", () => {
    const { Disposable } = require("lumine");
    for (const method of [
      "onDidAddDecoration",
      "onDidRemoveDecoration",
      "onDidUpdateDecorations",
    ]) {
      spyOn(editor, method).and.callFake(() => new Disposable());
    }
    const isolated = new strip.constructor(editor, marker.provideMarkerRegistry(), { scale: 1 });
    strip.element.parentNode.appendChild(isolated.element);
    try {
      isolated.handle.updateSync();
      isolated.drawMarkers();
      const items = layer.items;
      const stopped = jasmine.createSpy("stopped changing");
      const stopSubscription = editor.onDidStopChanging(stopped);
      const draw = spyOn(isolated.canvas, "draw").and.callThrough();
      editor.setCursorBufferPosition([50, 0]);
      for (let index = 0; index < 5; index++) {
        editor.insertNewline();
        frame();
        expect(draw).toHaveBeenCalledTimes(index + 1);
        expect(layer.items).toBe(items);
      }
      expect(stopped).not.toHaveBeenCalled();
      stopSubscription.dispose();
    } finally {
      isolated.destroy();
    }
  });

  it("waits for late editor measurements before projecting scrollbar geometry", () => {
    const draw = spyOn(strip.canvas, "draw").and.callThrough();
    let trackHeight = 300;
    const getGeometry = lumine.scrollbars.getGeometry.bind(lumine.scrollbars);
    spyOn(lumine.scrollbars, "getGeometry").and.callFake((element) => {
      const geometry = getGeometry(element);
      return element === editor.getElement()
        ? { ...geometry, verticalTrackSize: trackHeight }
        : geometry;
    });
    strip.updateView();
    // A later reader can publish a newly measured track height. Paint must
    // project into that value rather than the earlier geometry snapshot.
    lumine.views.readDocument(() => (trackHeight = 280));

    frame();

    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.calls.mostRecent().args[2]).toBe(280);
  });

  it("reuses unchanged layer projections and invalidates them when row geometry moves", () => {
    const fixedProvider = marker.consumeMarkerLayer({
      name: "fixed-projection",
      getItems: () => [{ row: 60 }],
    });
    strip.handle.updateSync();
    frame();
    const fixed = strip.handle.layerFor("fixed-projection");
    const project = spyOn(strip, "regionsFor").and.callThrough();
    row = 25;
    layer.update();
    frame();
    expect(project.calls.allArgs().map(([current]) => current)).toEqual([layer]);
    project.calls.reset();
    const version = editor.component.getRowGeometryVersion();
    spyOn(editor.component, "getRowGeometryVersion").and.returnValue(version + 1);
    strip.updateView();
    frame();
    expect(project.calls.allArgs().map(([current]) => current)).toContain(fixed);
    expect(project.calls.allArgs().map(([current]) => current)).toContain(layer);
    fixedProvider.dispose();
  });

  it("cancels the paint when hidden between document reads and writes", () => {
    const draw = spyOn(strip.canvas, "draw").and.callThrough();
    strip.updateView();
    drain(reads);
    strip.setVisible(false);
    drain(writes, { includeCancelled: true });
    expect(draw).not.toHaveBeenCalled();
    expect(strip.pendingUpdate).toBeNull();
  });

  it("does not schedule a stale read after destruction", () => {
    const draw = spyOn(strip.canvas, "draw");
    strip.updateView();
    strip.destroy();
    drain(reads, { includeCancelled: true });
    expect(writes).toEqual([]);
    expect(draw).not.toHaveBeenCalled();
  });
});

describe("scrollmap initial frame scheduling", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  it("computes attached layers before the first shared document paint", async () => {
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "600px";
    jasmine.attachToDOM(workspace);
    lumine.config.set("marker.cursors.enabled", false);
    const marker = (await lumine.packages.activatePackage("marker")).mainModule;
    const main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    main.consumer.dispose();
    const editor = await lumine.workspace.open();
    editor.setText("first shared frame\n".repeat(100));
    lumine.views.performDocumentUpdate();

    const frames = [];
    spyOn(window, "requestAnimationFrame").and.callFake((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const getItems = jasmine.createSpy("initial items").and.returnValue([{ row: 12 }]);
    const provider = marker.consumeMarkerLayer({ name: "initial-frame", getItems });
    const service = marker.provideMarkerRegistry();
    const draw = spyOn(service.MarkerCanvas.prototype, "draw").and.callThrough();
    const consumer = main.consumeMarkerRegistry(service);
    try {
      await flushMicrotasks();
      const strip = main.scrollmapForEditor(editor);
      expect(strip).toBeDefined();
      expect(getItems).not.toHaveBeenCalled();

      lumine.views.performDocumentUpdate();

      expect(frames.length).toBeGreaterThan(0);
      expect(getItems).toHaveBeenCalledTimes(1);
      expect(strip.handle.layerFor("initial-frame").items).toEqual([{ row: 12 }]);
      const paint = draw.calls.all().findLast((call) => call.object === strip.canvas);
      expect(paint?.args[0].map((region) => region.className)).toContain(
        "marker marker-initial-frame",
      );
      expect(strip.pendingUpdate).toBeNull();
    } finally {
      consumer.dispose();
      provider.dispose();
    }
  });
});
