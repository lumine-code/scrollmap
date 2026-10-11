const { CompositeDisposable, Disposable } = require("lumine");
const toolkit = require("./toolkit");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "scrollmap",
      tips: [
        "You can choose which marker layers the scrollbar shows with {{ 'scrollmap:show-layers' | keystroke }}",
      ],
    };
  },

  activate() {
    this.scrollmaps = new WeakMap();
    this.registryConnections = new Map();
    this.connection = null;
    this.picker = null;
    this.consumer = null;
    this.registry = null;
    this.runtimeReady = false;
    // The draw-time filters every strip reads. The hub keeps items full-length,
    // so which layers show, and past what count they hide, is decided here.
    this.filters = {
      disabled: lumine.config.get("scrollmap.disabledLayers") ?? [],
      scale: lumine.config.get("scrollmap.thresholdScale") ?? 1,
    };
    this.disposables = new CompositeDisposable();

    // These measurements are global like the theme variables, so publish them
    // from a real `:root` rule rather than as inline styles on `<html>`. The
    // stylesheet is private to this activation and leaves with the package.
    const root = document.documentElement;
    root.style.removeProperty("--scrollbar-width");
    root.style.removeProperty("--scrollbar-bottom");
    const geometryStyle = document.createElement("style");
    geometryStyle.dataset.scrollmap = "scrollbar-geometry";
    geometryStyle.textContent = `
      :root {
        --scrollbar-width: 0px;
        --scrollbar-bottom: 0px;
      }
    `;
    document.head.appendChild(geometryStyle);
    this.scrollbarGeometryRule = geometryStyle.sheet.cssRules[0];
    this.disposables.add(
      new Disposable(() => {
        geometryStyle.remove();
        this.scrollbarGeometryRule = null;
      }),
      lumine.config.onDidChange("scrollmap.overlayWidth", () => {
        this.measureScrollbar();
        for (const connection of this.registryConnections.values()) this.updateAll(connection);
      }),
      lumine.workspace.onDidChangeActiveTextEditor((editor) => {
        this.measureScrollbar(editor);
      }),
      lumine.commands.add("lumine-workspace", {
        "scrollmap:show-layers": {
          description: "Choose which marker layers the scrollbar map draws.",
          didDispatch: () => this.showLayers(),
        },
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
  },

  // The picker only exists once the marker hub has been consumed. Without that
  // there is nothing to pick from, and a silent no-op leaves the user with no
  // way to tell an empty list from a missing package.
  showLayers() {
    if (!this.ensureRuntime() || !this.picker) {
      lumine.notifications.addWarning(
        "The marker package provides the layer list, and it is not active",
      );
      return;
    }
    this.picker.show();
  },

  // Everything that draws lives under the hub consumer: without the `marker`
  // package there are no layers, no strips and no picker, and the returned
  // disposable takes all of it down if the hub deactivates first.
  consumeMarkerRegistry(registry) {
    toolkit.install(registry);
    let connection = this.registryConnections.get(registry);
    if (!connection) {
      connection = {
        registry,
        references: 0,
        consumer: new CompositeDisposable(),
        scrollmaps: new Map(),
        picker: null,
        runtimeReady: false,
      };
      this.registryConnections.set(registry, connection);
      connection.consumer.add(
        new Disposable(() => {
          connection.picker?.destroy();
          this.disposables.remove(connection.consumer);
          if (this.registryConnections.get(registry) !== connection) return;
          this.registryConnections.delete(registry);
          if (this.connection === connection) {
            this.setCurrentRegistry([...this.registryConnections.values()].at(-1) ?? null);
          }
        }),
      );
      this.disposables.add(connection.consumer);
    }
    connection.references++;
    this.setCurrentRegistry(connection);

    // Service wiring belongs to the synchronous activation contract, but the
    // picker and one canvas per open editor do not. Build that UI immediately
    // after activation, or synchronously on the first command that needs it.
    queueMicrotask(() => {
      if (this.registryConnections.get(registry) === connection) {
        this.ensureRuntime(connection);
      }
    });
    return new Disposable(() => {
      if (this.registryConnections.get(registry) !== connection) return;
      if (--connection.references === 0) connection.consumer.dispose();
    });
  },

  setCurrentRegistry(connection) {
    this.connection = connection;
    this.consumer = connection?.consumer ?? null;
    this.registry = connection?.registry ?? null;
    this.picker = connection?.picker ?? null;
    this.runtimeReady = connection?.runtimeReady ?? false;
    this.scrollmaps = connection?.scrollmaps ?? new WeakMap();
    if (connection) toolkit.install(connection.registry);
  },

  ensureRuntime(connection = this.connection) {
    if (!connection || connection.consumer.disposed) return false;
    if (connection.runtimeReady) {
      return true;
    }
    const { consumer, registry } = connection;
    connection.runtimeReady = true;
    connection.picker = registry.createPicker({
      className: "scrollmap-view",
      emptyMessage: "No scrollmap layers found",
      disabledKey: "scrollmap.disabledLayers",
    });
    if (this.connection === connection) this.setCurrentRegistry(connection);

    consumer.add(
      registry.onDidChangeItems((layer) => {
        connection.scrollmaps.get(layer.editor)?.updateView();
      }),
      registry.onDidChangeLayers(() => {
        this.updateAll(connection);
      }),
      lumine.config.onDidChange("scrollmap.disabledLayers", ({ newValue }) => {
        this.filters.disabled = newValue ?? [];
        this.updateAll(connection);
      }),
      lumine.config.onDidChange("scrollmap.thresholdScale", ({ newValue }) => {
        this.filters.scale = newValue ?? 1;
        this.updateAll(connection);
      }),
      // Core combines stylesheet and theme changes in a microtask, early
      // enough for the marker repaint to be included in the cross-fade.
      lumine.themes.onDidChangeVariables(() => this.updateTheme(connection)),
    );
    // Added last: the callback fires synchronously for every editor already
    // open, and `attachEditor` parks each strip's teardown in the consumer.
    consumer.add(
      lumine.workspace.observeTextEditors((editor) => {
        this.attachEditor(editor, registry, consumer, connection);
      }),
    );
    return true;
  },

  attachEditor(editor, registry, consumer = this.consumer, connection = this.connection) {
    if (consumer?.disposed || editor.isDestroyed()) return;
    const scrollmaps = connection?.scrollmaps ?? this.scrollmaps;
    if (scrollmaps.has(editor)) return;
    const element = editor.getElement();
    if (!element) {
      return;
    }
    const scrollView = element.querySelector(".vertical-scrollbar");
    if (!scrollView) {
      return;
    }
    const Scrollmap = require("./scrollmap");
    const scrollmap = new Scrollmap(editor, registry, this.filters);
    scrollmaps.set(editor, scrollmap);
    let editorSubscription, measureFrame, updateFrame;
    const resizeObserver = new ResizeObserver(() => {
      if (disposable.disposed) return;
      // A resize changes what a percentage width resolves to, so the cached
      // marker styles have to go with it.
      scrollmap.canvas.invalidate();
      scrollmap.updateView();
    });
    resizeObserver.observe(element);
    const disposable = new Disposable(() => {
      editorSubscription?.dispose();
      cancelAnimationFrame(measureFrame);
      cancelAnimationFrame(updateFrame);
      resizeObserver.disconnect();
      scrollmap.destroy();
      scrollmaps.delete(editor);
      consumer?.remove(disposable);
    });
    editorSubscription = editor.onDidDestroy(() => disposable.dispose());
    consumer?.add(disposable);
    scrollView.parentNode.insertBefore(scrollmap.element, scrollView.nextSibling);
    measureFrame = requestAnimationFrame(() => {
      if (!disposable.disposed) this.measureScrollbar(editor);
    });
    updateFrame = requestAnimationFrame(() => {
      if (!disposable.disposed) scrollmap.update();
    });
  },

  scrollmapForEditor(editor) {
    return this.scrollmaps.get(editor);
  },

  updateAll(connection = this.connection) {
    for (const scrollmap of connection?.scrollmaps.values() ?? []) {
      scrollmap.updateView();
    }
  },

  updateTheme(connection = this.connection) {
    // A UI theme can change the scrollbar dimensions, and the maps are sized
    // against them, so re-measure before the layers read their styles back.
    this.measureScrollbar();
    for (const scrollmap of connection?.scrollmaps.values() ?? []) {
      scrollmap.updateTheme();
    }
  },

  // Publishes the scrollbar geometry for the panes that have no editor to ask.
  //
  // The editor strip sizes itself from its own component; `simplemap` draws
  // beside a PDF page or a notebook, where there is no component and no
  // scrollbar of its own to measure, so it takes the width from here.
  //
  // The dimensions come from the component rather than from live scrollbar
  // elements. The component measures with `overflow: scroll` forced, so they
  // are right even for an editor short enough to show no scrollbars at all --
  // measuring an element there yields 0, which used to leave the width at 0 and
  // every marker invisible until a longer file was opened.
  measureScrollbar(editor) {
    editor ??= lumine.workspace.getActiveTextEditor();
    const component = editor?.getElement()?.component;
    const measuredWidth = component?.getVerticalScrollbarWidth() ?? 0;
    const width = measuredWidth || lumine.config.get("scrollmap.overlayWidth") || 0;
    const bottom = component?.getHorizontalScrollbarHeight() ?? 0;
    this.publishScrollbarGeometry(width, bottom);
  },

  publishScrollbarGeometry(width, bottom) {
    const style = this.scrollbarGeometryRule?.style;
    if (!style) {
      return;
    }
    const widthValue = `${width}px`;
    const bottomValue = `${bottom}px`;
    // The dimensions almost never move, and every restyle asks again; writing
    // them back regardless would invalidate the styles of the whole window.
    if (
      style.getPropertyValue("--scrollbar-width") === widthValue &&
      style.getPropertyValue("--scrollbar-bottom") === bottomValue
    ) {
      return;
    }
    style.setProperty("--scrollbar-width", widthValue);
    style.setProperty("--scrollbar-bottom", bottomValue);
  },

  provideScrollmapWidget() {
    return require("./simplemap");
  },
};
