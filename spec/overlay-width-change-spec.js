beforeEach(() => {
  for (const operation of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
    if (!jasmine.isSpy(lumine.shell[operation])) spyOn(lumine.shell, operation).and.resolveTo();
  }
  if (!jasmine.isSpy(lumine.application.openWindow))
    spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Scrollmap overlay-width changes", () => {
  let editor, main, marker, style, layer, widgetConsumer, widget, widgetContainer;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("scrollmap"))
      await lumine.packages.unloadPackage("scrollmap");
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "400px";
    jasmine.attachToDOM(workspace);
    lumine.config.set("marker.cursors.enabled", false);
    lumine.config.set("scrollmap.overlayWidth", 7);
  });

  afterEach(async () => {
    widgetConsumer?.dispose();
    widgetConsumer = null;
    widget?.destroy();
    widget = null;
    widgetContainer?.remove();
    widgetContainer = null;
    layer?.dispose();
    layer = null;
    if (lumine.packages.isPackageLoaded("scrollmap"))
      await lumine.packages.unloadPackage("scrollmap");
    editor?.destroy();
    style?.dispose();
    style = null;
    await lumine.fileWatchClient.settlePendingTeardown();
  });

  async function start(width) {
    style = lumine.styles.addStyleSheet(
      `lumine-text-editor .vertical-scrollbar::-webkit-scrollbar { width: ${width}px; }
       lumine-text-editor .horizontal-scrollbar::-webkit-scrollbar { height: 0px; }
       .scrollmap .marker.marker-overlay-width-spec { background: rgb(255, 0, 0); width: 100%; }`,
      { priority: 1000 },
    );
    editor = await lumine.workspace.open();
    editor.getElement().setUpdatedSynchronously(true);
    editor.setText("row\n".repeat(100));
    marker = (await lumine.packages.activatePackage("marker")).mainModule;
    main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    layer = marker.consumeMarkerLayer({
      name: "overlay-width-spec",
      getItems: () => [{ row: 0, end: 99 }],
    });
    advanceClock(30);
    await frame();
    await frame();
    const map = main.scrollmapForEditor(editor);
    expect(map).toBeDefined();
    expect(editor.getElement().component.getVerticalScrollbarWidth()).toBe(width);
    expect(map.canvas.canvas.width).toBeGreaterThan(0);
    return map;
  }

  it("updates the drawn strip and widget geometry when the overlay setting changes", async () => {
    const map = await start(0);
    widgetConsumer = lumine.packages.serviceHub.consume(
      "scrollmap.widget",
      "^1.0.0",
      (Simplemap) => {
        widget = new Simplemap();
      },
    );
    widgetContainer = document.createElement("div");
    widgetContainer.style.cssText = "position: relative; width: 40px; height: 200px;";
    lumine.workspace.getElement().appendChild(widgetContainer);
    widgetContainer.appendChild(widget.element);
    widget.setItems([{ prc: 0, end: 100 }]);
    expect(map.element.style.width).toBe("7px");
    expect(widget.element.clientWidth).toBe(7);
    const before = map.canvas.canvas.width;

    lumine.config.set("scrollmap.overlayWidth", 15);
    await frame();
    await frame();

    expect(map.element.style.width).toBe("15px");
    expect(map.canvas.canvas.width).toBeGreaterThan(before);
    expect(main.scrollbarGeometryRule.style.getPropertyValue("--scrollbar-width")).toBe("15px");
    expect(widget.element.clientWidth).toBe(15);
  });

  it("retains the measured scrollbar width when the platform reserves space", async () => {
    const map = await start(12);
    expect(map.element.style.width).toBe("12px");
    const before = map.canvas.canvas.width;
    lumine.config.set("scrollmap.overlayWidth", 15);
    await frame();
    await frame();
    expect(map.element.style.width).toBe("12px");
    expect(map.canvas.canvas.width).toBe(before);
    expect(main.scrollbarGeometryRule.style.getPropertyValue("--scrollbar-width")).toBe("12px");
  });

  it("hides the overlay strip when its supported width setting becomes zero", async () => {
    const map = await start(0);
    expect(map.element.clientWidth).toBe(7);
    lumine.config.set("scrollmap.overlayWidth", 0);
    await frame();
    await frame();
    expect(map.element.style.width).toBe("0px");
    expect(map.element.clientWidth).toBe(0);
    expect(main.scrollbarGeometryRule.style.getPropertyValue("--scrollbar-width")).toBe("0px");
  });
});
