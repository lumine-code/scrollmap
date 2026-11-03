const { Disposable } = require("lumine");

describe("scrollmap widget layout visibility", () => {
  let fixture, widget, Simplemap, sheets;

  function items(cls) {
    return ["left", undefined, "right", "full"].map((position, index) => ({
      prc: index * 25,
      height: 4,
      position,
      cls,
    }));
  }

  function coloredColumns(y) {
    const canvas = widget.canvas.canvas;
    const context = canvas.getContext("2d");
    const ratio = canvas.width / 20;
    const columns = [];
    for (let x = 0; x < 20; x++) {
      const pixel = context.getImageData(
        Math.floor((x + 0.5) * ratio),
        Math.floor((y + 0.5) * ratio),
        1,
        1,
      ).data;
      if (pixel[3]) columns.push(x);
    }
    return columns;
  }

  function expectPositions() {
    expect(coloredColumns(0)).toEqual([0, 1, 2, 3]);
    expect(coloredColumns(50)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    expect(coloredColumns(100)).toEqual([16, 17, 18, 19]);
    expect(coloredColumns(150)).toEqual(Array.from({ length: 20 }, (_, index) => index));
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("marker");
    const main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    Simplemap = main.provideScrollmapWidget();
    fixture = document.createElement("div");
    fixture.style.cssText = "position:relative;width:20px;height:200px;display:none";
    jasmine.attachToDOM(fixture);
    sheets = [
      lumine.styles.addStyleSheet(
        ".marker.layout-a { background-color: rgb(255, 0, 0); } " +
          ".marker.layout-b { background-color: rgb(0, 255, 0); }",
      ),
    ];
  });

  afterEach(() => {
    widget?.destroy();
    fixture.remove();
    for (const sheet of sheets) sheet.dispose();
  });

  it("defers hidden bound markers and paints all positions after reveal at the same geometry", async () => {
    const geometry = { verticalSize: 20, viewportHeight: 200 };
    spyOn(lumine.scrollbars, "getVerticalTrack").and.returnValue(fixture);
    spyOn(lumine.scrollbars, "getGeometry").and.returnValue(geometry);
    spyOn(lumine.scrollbars, "observe").and.callFake((_element, callback) => {
      callback(geometry);
      return new Disposable();
    });
    widget = new Simplemap({ scrollElement: fixture });
    const draw = spyOn(widget.canvas, "draw").and.callThrough();
    widget.setItems(items("layout-a"));
    lumine.views.performDocumentUpdate();

    expect(widget.element.style.width).toBe("20px");
    expect(widget.element.style.height).toBe("200px");
    expect(draw).not.toHaveBeenCalled();
    expect(widget.drawSignature).toBeNull();
    expect(widget.canvas.styles.cache.size).toBe(0);

    fixture.style.display = "";
    await waitForFrames(() => widget.drawSignature !== null);

    expect(draw).toHaveBeenCalled();
    expectPositions();
  });

  it("resolves new marker classes and theme colors after an unchanged-size standalone widget returns", async () => {
    widget = new Simplemap();
    widget.element.style.width = "20px";
    widget.element.style.height = "200px";
    fixture.appendChild(widget.element);
    fixture.style.display = "";
    widget.setItems(items("layout-a"));
    // setItems paints synchronously. Wait for the observer's first nonzero
    // delivery too, before testing a later hide/reveal at that same size.
    const layoutRefresh = spyOn(widget.canvas, "invalidate").and.callThrough();
    await waitForFrames(() => layoutRefresh.calls.any() && widget.drawSignature !== null);
    expectPositions();

    fixture.style.display = "none";
    await waitForFrames(() => widget.drawSignature === null);
    const draw = spyOn(widget.canvas, "draw").and.callThrough();
    widget.setItems(items("layout-b"));
    sheets.push(
      lumine.styles.addStyleSheet(".marker.layout-b { background-color: rgb(0, 0, 255); }"),
    );
    await flushMicrotasks();
    widget.updateTheme();
    widget.drawMarkers(20, 200);
    expect(draw).not.toHaveBeenCalled();
    expect(widget.canvas.styles.cache.size).toBe(0);

    fixture.style.display = "";
    await waitForFrames(() => widget.drawSignature !== null);

    expectPositions();
    const ratio = widget.canvas.canvas.width / 20;
    const pixel = widget.canvas.canvas
      .getContext("2d")
      .getImageData(Math.floor(18.5 * ratio), Math.floor(100.5 * ratio), 1, 1).data;
    expect(Array.from(pixel)).toEqual([0, 0, 255, 255]);
  });

  it("paints standalone item changes and restyles when a hide and reveal share one task", async () => {
    widget = new Simplemap();
    widget.element.style.width = "20px";
    widget.element.style.height = "200px";
    fixture.appendChild(widget.element);
    fixture.style.display = "";
    widget.setItems(items("layout-a"));
    const layoutRefresh = spyOn(widget.canvas, "invalidate").and.callThrough();
    await waitForFrames(() => layoutRefresh.calls.any() && widget.drawSignature !== null);
    expectPositions();
    layoutRefresh.calls.reset();

    fixture.style.display = "none";
    widget.setItems(items("layout-b"));
    expect(widget.drawnItems[0].cls).toBe("layout-a");
    fixture.style.display = "";
    await waitForFrames(() => widget.drawnItems[0]?.cls === "layout-b");

    expectPositions();
    const ratio = widget.canvas.canvas.width / 20;
    const pixel = widget.canvas.canvas
      .getContext("2d")
      .getImageData(Math.floor(18.5 * ratio), Math.floor(100.5 * ratio), 1, 1).data;
    expect(Array.from(pixel)).toEqual([0, 255, 0, 255]);
    expect(layoutRefresh).not.toHaveBeenCalled();
    expect(widget.pendingUpdate).toBeNull();

    fixture.style.display = "none";
    sheets.push(
      lumine.styles.addStyleSheet(".marker.layout-b { background-color: rgb(0, 0, 255); }"),
    );
    widget.updateTheme();
    fixture.style.display = "";
    await waitForFrames(() => widget.drawSignature !== null && widget.pendingUpdate === null);

    expectPositions();
    const recolored = widget.canvas.canvas
      .getContext("2d")
      .getImageData(Math.floor(18.5 * ratio), Math.floor(100.5 * ratio), 1, 1).data;
    expect(Array.from(recolored)).toEqual([0, 0, 255, 255]);
  });
});
