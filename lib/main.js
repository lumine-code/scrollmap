const { CompositeDisposable, Disposable } = require("lumine");
const { coalesce } = require("./utils");
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
    const consumer = new CompositeDisposable(
      new Disposable(() => {
        if (this.consumer !== consumer) {
          return;
        }
        this.picker?.destroy();
        this.picker = null;
        this.consumer = null;
        this.registry = null;
        this.runtimeReady = false;
      }),
    );
    this.consumer = consumer;
    this.registry = registry;
    this.disposables.add(consumer);

    // Service wiring belongs to the synchronous activation contract, but the
    // picker and one canvas per open editor do not. Build that UI immediately
    // after activation, or synchronously on the first command that needs it.
    queueMicrotask(() => {
      if (this.consumer === consumer) {
        this.ensureRuntime();
      }
    });
    return consumer;
  },

  ensureRuntime() {
    if (this.runtimeReady) {
      return true;
    }
    const { consumer, registry } = this;
    if (!consumer || !registry) {
      return false;
    }
    this.runtimeReady = true;
    this.picker = registry.createPicker({
      className: "scrollmap-view",
      emptyMessage: "No scrollmap layers found",
      disabledKey: "scrollmap.disabledLayers",
    });

    // Coalesced rather than throttled: the bursts have to be answered within the
    // task that raised them. See `coalesce` in utils.
    const updateTheme = coalesce(() => this.updateTheme());
    consumer.add(
      registry.onDidChangeItems((layer) => {
        this.scrollmaps.get(layer.editor)?.updateView();
      }),
      registry.onDidChangeLayers(() => {
        this.updateAll();
      }),
      lumine.config.onDidChange("scrollmap.disabledLayers", ({ newValue }) => {
        this.filters.disabled = newValue ?? [];
        this.updateAll();
      }),
      lumine.config.onDidChange("scrollmap.thresholdScale", ({ newValue }) => {
        this.filters.scale = newValue ?? 1;
        this.updateAll();
      }),
      // A theme switch attaches its stylesheets from inside a View Transition,
      // and this is emitted synchronously as each one lands -- early enough for
      // the repaint to be part of the cross-fade. `onDidChangeActiveThemes` is
      // not: the switch emits it at the very end, long after the transition
      // started.
      lumine.styles.onDidAddStyleElement(updateTheme),
      // A variant switch through `lumine.themes.updateAppearance` restyles the
      // window without attaching a stylesheet, and emits this from inside its
      // cross-fade, so it is the only signal that path gives. Following a real
      // theme switch it arrives too late to be of use, but the style digest
      // makes that duplicate free.
      lumine.themes.onDidChangeActiveThemes(updateTheme),
    );
    // Added last: the callback fires synchronously for every editor already
    // open, and `attachEditor` parks each strip's teardown in the consumer.
    consumer.add(
      lumine.workspace.observeTextEditors((editor) => {
        this.attachEditor(editor, registry, consumer);
      }),
    );
    return true;
  },

  attachEditor(editor, registry, consumer = this.consumer) {
    const element = editor.getElement();
    if (!element) {
      return;
    }
    const scrollView = element.querySelector(".vertical-scrollbar");
    if (!scrollView) {
      return;
    }
    requestAnimationFrame(() => {
      this.measureScrollbar(editor);
    });
    const Scrollmap = require("./scrollmap");
    const scrollmap = new Scrollmap(editor, registry, this.filters);
    this.scrollmaps.set(editor, scrollmap);
    const resizeObserver = new ResizeObserver(() => {
      // A resize changes what a percentage width resolves to, so the cached
      // marker styles have to go with it.
      scrollmap.canvas.invalidate();
      scrollmap.updateView();
    });
    resizeObserver.observe(element);
    const disposable = new Disposable(() => {
      resizeObserver.disconnect();
      scrollmap.destroy();
      this.scrollmaps.delete(editor);
    });
    editor.onDidDestroy(() => {
      consumer?.remove(disposable);
      disposable.dispose();
    });
    consumer?.add(disposable);
    scrollView.parentNode.insertBefore(scrollmap.element, scrollView.nextSibling);
    requestAnimationFrame(() => {
      scrollmap.update();
    });
  },

  scrollmapForEditor(editor) {
    return this.scrollmaps.get(editor);
  },

  updateAll() {
    for (const editor of lumine.workspace.getTextEditors()) {
      this.scrollmaps.get(editor)?.updateView();
    }
  },

  updateTheme() {
    // A UI theme can change the scrollbar dimensions, and the maps are sized
    // against them, so re-measure before the layers read their styles back.
    this.measureScrollbar();
    for (const editor of lumine.workspace.getTextEditors()) {
      this.scrollmaps.get(editor)?.updateTheme();
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
