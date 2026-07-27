describe("scrollmap", () => {
  let workspaceElement, specStyle, styleSheets;

  // The spec runner freezes setTimeout, so poll on animation frames instead.
  function waitFor(condition, { frames = 600 } = {}) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const check = () => {
        let value;
        try {
          value = condition();
        } catch {
          value = null;
        }
        if (value) {
          resolve(value);
        } else if (++count > frames) {
          reject(new Error("Timed out waiting for condition"));
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  async function activate() {
    const pack = await atom.packages.activatePackage("scrollmap");
    return pack.mainModule;
  }

  // Markers are drawn centered on the map, so the middle of the canvas is where
  // the color of a marker spanning the whole height lands.
  function markerColor(canvas) {
    const ctx = canvas.getContext("2d");
    const x = Math.floor(canvas.width / 2);
    const y = Math.floor(canvas.height / 2);
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // Restyle the window the way a theme switch does: attach a stylesheet through
  // `atom.styles`, which is what announces the swap to its consumers.
  function restyle(css) {
    const disposable = atom.styles.addStyleSheet(css);
    styleSheets.push(disposable);
    return disposable;
  }

  function canvasHasInk(canvas) {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        return true;
      }
    }
    return false;
  }

  beforeEach(() => {
    workspaceElement = atom.views.getView(atom.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);

    specStyle = document.createElement("style");
    specStyle.textContent = `
      .marker.spec-marker { background-color: rgb(255, 0, 0); width: 100%; }
      .marker.spec-plain { background-color: rgb(0, 255, 0); }
      .marker.marker-speclayer { background-color: rgb(0, 128, 255); }
    `;
    document.head.appendChild(specStyle);
    styleSheets = [];
  });

  afterEach(() => {
    specStyle.remove();
    for (const disposable of styleSheets) {
      disposable.dispose();
    }
  });

  describe("activation", () => {
    it("activates and registers the toggle command", async () => {
      await activate();
      expect(atom.packages.isPackageActive("scrollmap")).toBe(true);
      const commands = atom.commands
        .findCommands({ target: workspaceElement })
        .map((command) => command.name);
      expect(commands).toContain("scrollmap:toggle-layers");
    });

    it("initializes the scrollbar CSS variables on the root element", async () => {
      await activate();
      const root = document.documentElement;
      expect(root.style.getPropertyValue("--scrollbar-width")).not.toBe("");
      expect(root.style.getPropertyValue("--scrollbar-bottom")).not.toBe("");
    });
  });

  describe("scrollmap.widget service", () => {
    let Simplemap, mainModule;

    beforeEach(async () => {
      mainModule = await activate();
      Simplemap = mainModule.provideScrollmapWidget();
    });

    it("provides an instantiable class exposing element, setItems and destroy", () => {
      const simplemap = new Simplemap();
      expect(simplemap.element instanceof HTMLElement).toBe(true);
      expect(simplemap.element.classList.contains("simplemap")).toBe(true);
      expect(simplemap.element.querySelector("canvas.scrollmap-canvas")).not.toBeNull();
      expect(typeof simplemap.setItems).toBe("function");
      expect(typeof simplemap.destroy).toBe("function");
    });

    it("renders markers on the canvas from percent-based items", () => {
      const container = document.createElement("div");
      container.style.cssText = "position: relative; width: 20px; height: 200px;";
      workspaceElement.appendChild(container);

      const simplemap = new Simplemap();
      simplemap.element.style.width = "20px";
      simplemap.element.style.height = "200px";
      container.appendChild(simplemap.element);

      const canvas = simplemap.element.querySelector("canvas.scrollmap-canvas");
      expect(canvasHasInk(canvas)).toBe(false);

      simplemap.setItems([
        { prc: 10, cls: "spec-marker" },
        { prc: 50, end: 60, cls: "spec-marker" },
      ]);

      // Style probes are created for every rendered marker class.
      const probes = simplemap.element.querySelectorAll(".scrollmap-style-resolver .marker");
      expect(probes.length).toBe(1);
      expect(canvasHasInk(canvas)).toBe(true);

      simplemap.setItems([]);
      expect(canvasHasInk(canvas)).toBe(false);

      simplemap.destroy();
      expect(simplemap.element.parentNode).toBeNull();
    });

    it("stretches markers over the whole width for the full position", () => {
      const container = document.createElement("div");
      container.style.cssText = "position: relative; width: 20px; height: 200px;";
      workspaceElement.appendChild(container);

      const simplemap = new Simplemap();
      simplemap.element.style.width = "20px";
      simplemap.element.style.height = "200px";
      container.appendChild(simplemap.element);

      simplemap.setItems([
        { prc: 10, cls: "spec-plain" },
        { prc: 50, end: 60, position: "full", cls: "spec-plain" },
      ]);

      const resolver = simplemap.element.querySelector(".scrollmap-style-resolver");
      const centered = resolver.querySelector(".marker:not(.full)");
      const full = resolver.querySelector(".marker.full");
      expect(full.offsetWidth).toBe(20);
      expect(centered.offsetWidth).toBeLessThan(full.offsetWidth);
      expect(full.offsetLeft).toBe(0);

      simplemap.destroy();
      container.remove();
    });

    it("repaints its canvas when the window is restyled", async () => {
      const container = document.createElement("div");
      container.style.cssText = "position: relative; width: 20px; height: 200px;";
      workspaceElement.appendChild(container);

      const simplemap = new Simplemap();
      simplemap.element.style.width = "20px";
      simplemap.element.style.height = "200px";
      container.appendChild(simplemap.element);
      simplemap.setItems([{ prc: 0, end: 100, cls: "spec-plain" }]);

      const canvas = simplemap.element.querySelector("canvas.scrollmap-canvas");
      expect(markerColor(canvas)).toBe("rgba(0, 255, 0, 255)");

      restyle(".simplemap .marker.spec-plain { background-color: rgb(255, 255, 0); }");
      await null;
      expect(markerColor(canvas)).toBe("rgba(255, 255, 0, 255)");

      simplemap.destroy();
      container.remove();
    });

    it("stops following restyles once destroyed", async () => {
      const simplemap = new Simplemap();
      simplemap.destroy();

      spyOn(simplemap, "drawMarkers");
      restyle(".simplemap .marker.spec-plain { background-color: rgb(255, 255, 0); }");
      await null;
      expect(simplemap.drawMarkers).not.toHaveBeenCalled();
    });
  });

  describe("editor scrollmaps", () => {
    let editor, editorElement, mainModule, scrollmap;

    beforeEach(async () => {
      editor = await atom.workspace.open();
      editor.setText(Array(100).fill("hello world").join("\n"));
      editorElement = atom.views.getView(editor);
      await waitFor(() => editorElement.querySelector(".vertical-scrollbar"));
      mainModule = await activate();
      await waitFor(() => mainModule.scrollmapForEditor(editor));
      scrollmap = mainModule.scrollmapForEditor(editor);
    });

    // The strip used to take its width from a CSS variable measured off a live
    // scrollbar element, which reports 0 for an editor whose content fits: the
    // markers of a short file stayed invisible until a file long enough to
    // scroll was opened.
    it("draws for an editor too short to have a scrollbar", async () => {
      const shortEditor = await atom.workspace.open();
      shortEditor.setText("one line");
      const shortElement = atom.views.getView(shortEditor);
      await waitFor(() => mainModule.scrollmapForEditor(shortEditor));
      const shortMap = mainModule.scrollmapForEditor(shortEditor);

      // No scrollbar is rendered, which is the whole point of the case.
      const scrollbar = shortElement.querySelector(".vertical-scrollbar");
      expect(scrollbar.offsetWidth - scrollbar.clientWidth).toBe(0);

      // And the strip may not fall back on a width some other editor happened
      // to publish: this editor's own component is the only source.
      const root = document.documentElement;
      root.style.setProperty("--scrollbar-width", "0");
      root.style.setProperty("--scrollbar-bottom", "0");

      mainModule.consumeMarkerLayer({
        name: "speclayer",
        getItems: () => [{ row: 0 }],
      });
      advanceClock(30);
      advanceClock(30);

      const canvas = shortMap.element.querySelector("canvas.scrollmap-canvas");
      await waitFor(() => canvasHasInk(canvas));
      expect(shortMap.element.offsetWidth).toBeGreaterThan(0);
    });

    it("attaches a scrollmap element next to the editor scrollbar", () => {
      expect(scrollmap.element.classList.contains("scrollmap")).toBe(true);
      expect(editorElement.contains(scrollmap.element)).toBe(true);
      expect(scrollmap.element.querySelector("canvas.scrollmap-canvas")).not.toBeNull();
    });

    it("adds layers from marker.layer providers and renders their items", async () => {
      const disposable = mainModule.consumeMarkerLayer({
        name: "speclayer",
        description: "Spec layer",
        getItems: () => [{ row: 0 }, { row: 5, end: 8, cls: "extra" }],
      });

      const layer = scrollmap.set.layers.get("speclayer");
      expect(layer).toBeDefined();

      // Flush the two throttled stages (scrollmap update, then layer update).
      advanceClock(30);
      advanceClock(30);
      expect(layer.items.length).toBe(2);

      const regions = [];
      scrollmap.regionsFor(layer, 1, 1, regions);
      expect(regions[0].className).toContain("marker-speclayer");
      expect(regions[1].className).toContain("extra");
      expect(typeof regions[0].y).toBe("number");
      expect(regions[1].height).toBeGreaterThan(regions[0].height);

      const canvas = scrollmap.element.querySelector("canvas.scrollmap-canvas");
      await waitFor(() => canvasHasInk(canvas));

      disposable.dispose();
      expect(scrollmap.set.layers.has("speclayer")).toBe(false);
      expect(mainModule.host.providers.has("speclayer")).toBe(false);
    });

    it("sorts and merges adjacent items for layers with the merge flag", () => {
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        merge: true,
        getItems: () => [
          { row: 20, end: 21, cls: "extra" },
          { row: 6, end: 8 },
          { row: 0 },
          { row: 9 },
          { row: 22, cls: "extra" },
          { row: 1, end: 2 },
        ],
      });

      advanceClock(30);
      advanceClock(30);

      const layer = scrollmap.set.layers.get("speclayer");
      const items = layer.items.map(({ row, end, cls }) => ({ row, end, cls }));
      expect(items).toEqual([
        { row: 0, end: 2, cls: undefined },
        { row: 6, end: 9, cls: undefined },
        { row: 20, end: 22, cls: "extra" },
      ]);
    });

    it("empties layers holding more items than their threshold setting", () => {
      atom.config.set("scrollmap.specThreshold", 2);
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        threshold: "scrollmap.specThreshold",
        getItems: () => [{ row: 0 }, { row: 5 }, { row: 10 }],
      });

      advanceClock(30);
      advanceClock(30);

      const layer = scrollmap.set.layers.get("speclayer");
      expect(layer.items).toEqual([]);

      // Raising the limit re-runs the layer through the config subscription.
      atom.config.set("scrollmap.specThreshold", 5);
      advanceClock(30);
      expect(layer.items.length).toBe(3);
    });

    it("leaves the provider's item objects untouched", () => {
      const items = [{ row: 0 }, { row: 5, end: 8 }];
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        getItems: () => items,
      });

      advanceClock(30);
      advanceClock(30);

      expect(scrollmap.set.layers.get("speclayer").items.length).toBe(2);
      expect(items).toEqual([{ row: 0 }, { row: 5, end: 8 }]);
    });

    it("refuses a second provider with an already registered name", () => {
      const first = mainModule.consumeMarkerLayer({
        name: "speclayer",
        getItems: () => [{ row: 0 }],
      });
      const second = mainModule.consumeMarkerLayer({
        name: "speclayer",
        getItems: () => [{ row: 5 }],
      });

      expect(scrollmap.set.layers.has("speclayer")).toBe(true);

      // Disposing the rejected consumer must not unregister the winner.
      second.dispose();
      expect(mainModule.host.providers.has("speclayer")).toBe(true);
      expect(scrollmap.set.layers.has("speclayer")).toBe(true);

      first.dispose();
      expect(mainModule.host.providers.has("speclayer")).toBe(false);
    });

    it("applies the layer position class and lets an item override it", () => {
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        position: "left",
        getItems: () => [{ row: 0 }, { row: 5, end: 8, position: "full", cls: "extra" }],
      });

      advanceClock(30);
      advanceClock(30);

      const regions = [];
      scrollmap.regionsFor(scrollmap.set.layers.get("speclayer"), 1, 1, regions);
      expect(regions[0].className).toBe("marker marker-speclayer left");
      expect(regions[1].className).toBe("marker marker-speclayer full extra");
    });

    it("skips layers listed in the disabledLayers setting", async () => {
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        getItems: () => [{ row: 0 }],
      });
      atom.config.set("scrollmap.disabledLayers", ["speclayer"]);

      advanceClock(30);
      advanceClock(30);
      await waitFor(() => scrollmap.set.layers.get("speclayer").items.length === 1);

      const canvas = scrollmap.element.querySelector("canvas.scrollmap-canvas");
      // Draw once more with the layer disabled and verify nothing is painted.
      scrollmap.drawMarkers();
      expect(canvasHasInk(canvas)).toBe(false);
    });

    describe("when the window is restyled", () => {
      let canvas;

      beforeEach(async () => {
        mainModule.consumeMarkerLayer({
          name: "speclayer",
          getItems: () => [{ row: 0, end: 99 }],
        });
        advanceClock(30);
        advanceClock(30);
        canvas = scrollmap.element.querySelector("canvas.scrollmap-canvas");
        await waitFor(() => canvasHasInk(canvas));
      });

      it("repaints the markers in the task that attached the stylesheet", async () => {
        expect(markerColor(canvas)).toBe("rgba(0, 128, 255, 255)");

        restyle(".scrollmap .marker.marker-speclayer { background-color: rgb(255, 0, 255); }");
        // Not yet: a theme swap attaches a burst of stylesheets, collapsed here
        // into a single repaint…
        expect(markerColor(canvas)).toBe("rgba(0, 128, 255, 255)");

        // …taken on a microtask rather than a timer or an animation frame. The
        // swap runs inside a View Transition that snapshots the window one frame
        // on, so this is the last moment a canvas can join the cross-fade.
        await null;
        expect(markerColor(canvas)).toBe("rgba(255, 0, 255, 255)");
      });

      it("repaints when a variant switch restyles without attaching a stylesheet", async () => {
        expect(markerColor(canvas)).toBe("rgba(0, 128, 255, 255)");

        // `updateAppearance` mutates the document from inside the cross-fade and
        // announces it with `onDidChangeActiveThemes`. No stylesheet lands, so
        // that event is the only signal this path gives.
        await atom.themes.updateAppearance(() => {
          specStyle.textContent = ".marker.marker-speclayer { background-color: rgb(0, 200, 0); }";
        });

        await null;
        expect(markerColor(canvas)).toBe("rgba(0, 200, 0, 255)");
      });

      it("leaves the canvas alone when the restyle misses the markers", async () => {
        // Every stylesheet attached anywhere in the window arrives here, at any
        // time. Let one through first: it settles the scrollbar measurement and
        // the style digest the guard compares against.
        restyle("/* a stylesheet that changes nothing */");
        await null;

        spyOn(scrollmap, "drawMarkers").and.callThrough();
        restyle(".unrelated-spec-rule { color: rgb(1, 2, 3); }");
        await null;
        expect(scrollmap.drawMarkers).not.toHaveBeenCalled();
        expect(markerColor(canvas)).toBe("rgba(0, 128, 255, 255)");
      });
    });
  });

  describe("scrollmap:toggle-layers", () => {
    it("opens the layer toggle panel listing registered providers", async () => {
      const mainModule = await activate();
      mainModule.consumeMarkerLayer({
        name: "speclayer",
        description: "Spec layer",
        getItems: () => [],
      });

      atom.commands.dispatch(workspaceElement, "scrollmap:toggle-layers");
      const view = await waitFor(() => document.querySelector(".scrollmap-view"));
      await waitFor(() => view.textContent.includes("speclayer"));

      atom.commands.dispatch(workspaceElement, "scrollmap:toggle-layers");
    });

    it("toggles layers in and out of the disabledLayers setting", async () => {
      const mainModule = await activate();
      mainModule.picker.toggle({ name: "speclayer" });
      expect(atom.config.get("scrollmap.disabledLayers")).toContain("speclayer");
      mainModule.picker.toggle({ name: "speclayer" });
      expect(atom.config.get("scrollmap.disabledLayers")).not.toContain("speclayer");
    });
  });
});
