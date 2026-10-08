const path = require("path");

describe("scrollmap marker registry ownership", () => {
  let mainModule, markerPackage, editor, editorElement, providers, registries;

  async function flush() {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  }

  function createRegistry() {
    const markerMain = markerPackage.mainModule;
    const registry = new markerMain.registry.constructor();
    const { LayerPicker } = require(path.join(markerPackage.path, "lib/picker"));
    const service = {
      ...markerMain.provideMarkerRegistry(),
      attach: (target) => registry.attach(target),
      providers: () => [...registry.providers.values()],
      onDidChangeItems: (callback) => registry.onDidChangeItems(callback),
      onDidChangeLayers: (callback) => registry.onDidChangeLayers(callback),
      createPicker: (options) => new LayerPicker({ registry, ...options }),
    };
    registries.push(registry);
    return { registry, service };
  }

  async function provide(service) {
    const provider = lumine.packages.serviceHub.provide("marker.registry", "1.0.0", service);
    providers.push(provider);
    await flush();
    return provider;
  }

  beforeEach(async () => {
    const workspaceElement = lumine.views.getView(lumine.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);
    editor = await lumine.workspace.open();
    editor.setText(Array(100).fill("registry ownership").join("\n"));
    editorElement = lumine.views.getView(editor);
    await conditionPromise(() => editorElement.querySelector(".vertical-scrollbar"));
    markerPackage = await lumine.packages.activatePackage("marker");
    mainModule = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    mainModule.consumer.dispose();
    providers = [];
    registries = [];
  });

  afterEach(async () => {
    for (const provider of providers) provider.dispose();
    if (lumine.packages.isPackageActive("scrollmap")) {
      await lumine.packages.deactivatePackage("scrollmap");
    }
    for (const registry of registries) registry.destroy();
  });

  it("retains a newer strip and picker when the previous registry provider retires", async () => {
    const older = createRegistry();
    const oldProvider = await provide(older.service);
    const oldStrip = mainModule.scrollmapForEditor(editor);
    const oldPicker = mainModule.picker;
    spyOn(oldPicker, "destroy").and.callThrough();
    const newer = createRegistry();
    await provide(newer.service);
    const currentStrip = mainModule.scrollmapForEditor(editor);
    const currentPicker = mainModule.picker;
    expect(currentStrip).not.toBe(oldStrip);
    expect(currentPicker).not.toBe(oldPicker);
    spyOn(currentPicker, "destroy").and.callThrough();

    oldProvider.dispose();

    expect(oldStrip.destroyed).toBe(true);
    expect(oldPicker.destroy).toHaveBeenCalledTimes(1);
    expect(mainModule.scrollmapForEditor(editor)).toBe(currentStrip);
    expect(currentStrip.destroyed).toBe(false);
    expect(editorElement.contains(currentStrip.element)).toBe(true);
    expect(currentPicker.destroy).not.toHaveBeenCalled();
    expect(older.registry.sets.has(editor)).toBe(false);
    expect(newer.registry.sets.get(editor).refs).toBe(1);
  });

  it("shares a registry's strip and refcount until its last service edge disappears", async () => {
    const { registry, service } = createRegistry();
    const externalHandle = service.attach(editor);
    const first = await provide(service);
    const strip = mainModule.scrollmapForEditor(editor);
    const picker = mainModule.picker;
    const second = await provide(service);
    expect(mainModule.scrollmapForEditor(editor)).toBe(strip);
    expect(mainModule.picker).toBe(picker);
    expect(registry.sets.get(editor).refs).toBe(2);
    first.dispose();
    expect(strip.destroyed).toBe(false);
    expect(mainModule.scrollmapForEditor(editor)).toBe(strip);
    expect(registry.sets.get(editor).refs).toBe(2);

    second.dispose();
    expect(strip.destroyed).toBe(true);
    expect(registry.destroyed).toBe(false);
    expect(registry.sets.get(editor).refs).toBe(1);
    externalHandle.dispose();
    expect(registry.sets.has(editor)).toBe(false);
  });

  it("routes each registry's marker events to the strips that own its handles", async () => {
    const older = createRegistry();
    await provide(older.service);
    const oldStrip = mainModule.scrollmapForEditor(editor);
    const newer = createRegistry();
    await provide(newer.service);
    const currentStrip = mainModule.scrollmapForEditor(editor);
    spyOn(oldStrip, "updateView");
    spyOn(currentStrip, "updateView");

    older.registry.emitItemsChanged({ editor });
    expect(oldStrip.updateView).toHaveBeenCalledTimes(1);
    expect(currentStrip.updateView).not.toHaveBeenCalled();
    newer.registry.emitItemsChanged({ editor });
    expect(currentStrip.updateView).toHaveBeenCalledTimes(1);
  });

  it("disposes its editor destroy listener when a registry retires before the editor", async () => {
    const subscriptions = [];
    const subscribe = editor.onDidDestroy.bind(editor);
    spyOn(editor, "onDidDestroy").and.callFake((callback) => {
      const subscription = subscribe(callback);
      spyOn(subscription, "dispose").and.callThrough();
      subscriptions.push(subscription);
      return subscription;
    });
    const { service } = createRegistry();
    const provider = await provide(service);
    const ownerSubscription = subscriptions.at(-1);
    provider.dispose();
    expect(editor.isDestroyed()).toBe(false);
    expect(ownerSubscription.dispose).toHaveBeenCalledTimes(1);
  });

  it("restores an older live registry lookup when the newer provider retires first", async () => {
    const older = createRegistry();
    await provide(older.service);
    const oldStrip = mainModule.scrollmapForEditor(editor);
    const oldPicker = mainModule.picker;
    const newer = createRegistry();
    const newestProvider = await provide(newer.service);
    const latestStrip = mainModule.scrollmapForEditor(editor);
    newestProvider.dispose();
    expect(latestStrip.destroyed).toBe(true);
    expect(mainModule.scrollmapForEditor(editor)).toBe(oldStrip);
    expect(oldStrip.destroyed).toBe(false);
    expect(mainModule.picker).toBe(oldPicker);
    expect(older.registry.sets.get(editor).refs).toBe(1);
  });

  it("releases every strip once when the editor is destroyed before providers", async () => {
    const older = createRegistry();
    await provide(older.service);
    const oldStrip = mainModule.scrollmapForEditor(editor);
    const newer = createRegistry();
    await provide(newer.service);
    const currentStrip = mainModule.scrollmapForEditor(editor);
    spyOn(oldStrip, "destroy").and.callThrough();
    spyOn(currentStrip, "destroy").and.callThrough();

    editor.destroy();
    for (const provider of providers) provider.dispose();
    expect(oldStrip.destroy).toHaveBeenCalledTimes(1);
    expect(currentStrip.destroy).toHaveBeenCalledTimes(1);
    expect(older.registry.sets.has(editor)).toBe(false);
    expect(newer.registry.sets.has(editor)).toBe(false);
    expect(mainModule.scrollmapForEditor(editor)).toBeUndefined();
  });

  it("keeps each pending registry's canvas constructor when providers arrive in one turn", async () => {
    const older = createRegistry();
    const newer = createRegistry();
    const oldCanvases = [];
    const newCanvases = [];
    const MarkerCanvas = older.service.MarkerCanvas;
    older.service.MarkerCanvas = class extends MarkerCanvas {
      constructor(options) {
        super(options);
        oldCanvases.push(this);
      }
    };
    newer.service.MarkerCanvas = class extends MarkerCanvas {
      constructor(options) {
        super(options);
        newCanvases.push(this);
      }
    };
    const oldProvider = lumine.packages.serviceHub.provide(
      "marker.registry",
      "1.0.0",
      older.service,
    );
    providers.push(oldProvider);
    providers.push(lumine.packages.serviceHub.provide("marker.registry", "1.0.0", newer.service));
    await flush();
    expect(oldCanvases.length).toBe(1);
    expect(newCanvases.length).toBe(1);
    oldProvider.dispose();
    expect(oldCanvases[0]?.element.isConnected).toBe(false);
    expect(newCanvases[0]?.element.isConnected).toBe(true);
  });

  it("cancels pending attachment frames and makes already queued callbacks inert", async () => {
    const callbacks = [];
    let frame = 0;
    spyOn(window, "requestAnimationFrame").and.callFake((callback) => {
      callbacks.push(callback);
      return ++frame;
    });
    spyOn(window, "cancelAnimationFrame").and.callThrough();
    const { service } = createRegistry();
    const provider = await provide(service);
    const strip = mainModule.scrollmapForEditor(editor);
    spyOn(strip, "update").and.callThrough();
    spyOn(mainModule, "measureScrollbar").and.callThrough();
    provider.dispose();
    for (const callback of callbacks.slice()) callback(0);
    expect(window.cancelAnimationFrame.calls.count()).toBeGreaterThanOrEqual(2);
    expect(strip.update).not.toHaveBeenCalled();
    expect(mainModule.measureScrollbar).not.toHaveBeenCalled();
  });
});
