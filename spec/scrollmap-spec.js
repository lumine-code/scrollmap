describe("scrollmap", () => {
  let workspaceElement, specStyle;

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
      .marker.marker-speclayer { background-color: rgb(0, 128, 255); }
    `;
    document.head.appendChild(specStyle);
  });

  afterEach(() => {
    specStyle.remove();
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

  describe("simplemap service", () => {
    let Simplemap, mainModule;

    beforeEach(async () => {
      mainModule = await activate();
      Simplemap = mainModule.provideSimplemap();
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

    it("attaches a scrollmap element next to the editor scrollbar", () => {
      expect(scrollmap.element.classList.contains("scrollmap")).toBe(true);
      expect(editorElement.contains(scrollmap.element)).toBe(true);
      expect(scrollmap.element.querySelector("canvas.scrollmap-canvas")).not.toBeNull();
    });

    it("adds layers from scrollmap service providers and renders their items", async () => {
      const disposable = mainModule.consumeScrollmap({
        name: "speclayer",
        description: "Spec layer",
        getItems: () => [{ row: 0 }, { row: 5, end: 8, cls: "extra" }],
      });

      const layer = scrollmap.layers.get("speclayer");
      expect(layer).toBeDefined();

      // Flush the two throttled stages (scrollmap update, then layer update).
      advanceClock(30);
      advanceClock(30);
      expect(layer.items.length).toBe(2);
      expect(layer.items[0].className).toContain("marker-speclayer");
      expect(layer.items[1].className).toContain("extra");
      expect(typeof layer.items[0].pix).toBe("number");
      expect(typeof layer.items[1].piz).toBe("number");

      const canvas = scrollmap.element.querySelector("canvas.scrollmap-canvas");
      await waitFor(() => canvasHasInk(canvas));

      disposable.dispose();
      expect(scrollmap.layers.has("speclayer")).toBe(false);
      expect(mainModule.providers.has("speclayer")).toBe(false);
    });

    it("skips layers listed in the disabledLayers setting", async () => {
      mainModule.consumeScrollmap({
        name: "speclayer",
        getItems: () => [{ row: 0 }],
      });
      atom.config.set("scrollmap.disabledLayers", ["speclayer"]);

      advanceClock(30);
      advanceClock(30);
      await waitFor(() => scrollmap.layers.get("speclayer").items.length === 1);

      const canvas = scrollmap.element.querySelector("canvas.scrollmap-canvas");
      // Draw once more with the layer disabled and verify nothing is painted.
      scrollmap.drawMarkers();
      expect(canvasHasInk(canvas)).toBe(false);
    });
  });

  describe("scrollmap:toggle-layers", () => {
    it("opens the layer toggle panel listing registered providers", async () => {
      const mainModule = await activate();
      mainModule.consumeScrollmap({
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
      mainModule.toggleView.toggleLayer("speclayer");
      expect(atom.config.get("scrollmap.disabledLayers")).toContain("speclayer");
      mainModule.toggleView.toggleLayer("speclayer");
      expect(atom.config.get("scrollmap.disabledLayers")).not.toContain("speclayer");
    });
  });
});
