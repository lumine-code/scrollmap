const { CompositeDisposable, Disposable } = require("atom");
const { coalesce } = require("./utils");
const toolkit = require("./toolkit");

module.exports = {
  activate() {
    this.scrollmaps = new WeakMap();
    this.picker = null;
    this.consumer = null;
    // The draw-time filters every strip reads. The hub keeps items full-length,
    // so which layers show, and past what count they hide, is decided here.
    this.filters = {
      disabled: atom.config.get("scrollmap.disabledLayers") ?? [],
      scale: atom.config.get("scrollmap.thresholdScale") ?? 1,
    };
    this.disposables = new CompositeDisposable();

    // Seeded and measured even while the marker hub is absent: `simplemap`
    // widgets size themselves from these variables, not from the hub.
    const root = document.documentElement;
    root.style.setProperty("--scrollbar-width", "0");
    root.style.setProperty("--scrollbar-bottom", "0");
    this.disposables.add(
      atom.workspace.onDidChangeActiveTextEditor((editor) => {
        this.measureScrollbar(editor);
      }),
      atom.commands.add("atom-workspace", {
        "scrollmap:show-layers": () => this.showLayers(),
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
    if (!this.picker) {
      atom.notifications.addWarning(
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

    this.picker = registry.createPicker({
      className: "scrollmap-view",
      emptyMessage: "No scrollmap layers found",
      disabledKey: "scrollmap.disabledLayers",
    });

    // Coalesced rather than throttled: the bursts have to be answered within the
    // task that raised them. See `coalesce` in utils.
    const updateTheme = coalesce(() => this.updateTheme());
    this.consumer = new CompositeDisposable(
      registry.onDidChangeItems((layer) => {
        this.scrollmaps.get(layer.editor)?.updateView();
      }),
      registry.onDidChangeLayers(() => {
        this.updateAll();
      }),
      atom.config.onDidChange("scrollmap.disabledLayers", ({ newValue }) => {
        this.filters.disabled = newValue ?? [];
        this.updateAll();
      }),
      atom.config.onDidChange("scrollmap.thresholdScale", ({ newValue }) => {
        this.filters.scale = newValue ?? 1;
        this.updateAll();
      }),
      // A theme switch attaches its stylesheets from inside a View Transition,
      // and this is emitted synchronously as each one lands -- early enough for
      // the repaint to be part of the cross-fade. `onDidChangeActiveThemes` is
      // not: the switch emits it at the very end, long after the transition
      // started.
      atom.styles.onDidAddStyleElement(updateTheme),
      // A variant switch through `atom.themes.updateAppearance` restyles the
      // window without attaching a stylesheet, and emits this from inside its
      // cross-fade, so it is the only signal that path gives. Following a real
      // theme switch it arrives too late to be of use, but the style digest
      // makes that duplicate free.
      atom.themes.onDidChangeActiveThemes(updateTheme),
      new Disposable(() => {
        this.picker?.destroy();
        this.picker = null;
      }),
    );
    // Added last: the callback fires synchronously for every editor already
    // open, and `attachEditor` parks each strip's teardown in the consumer.
    this.consumer.add(
      atom.workspace.observeTextEditors((editor) => {
        this.attachEditor(editor, registry);
      }),
    );
    this.disposables.add(this.consumer);
    return this.consumer;
  },

  attachEditor(editor, registry) {
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
      this.consumer.remove(disposable);
      disposable.dispose();
    });
    this.consumer.add(disposable);
    scrollView.parentNode.insertBefore(scrollmap.element, scrollView.nextSibling);
    requestAnimationFrame(() => {
      scrollmap.update();
    });
  },

  scrollmapForEditor(editor) {
    return this.scrollmaps.get(editor);
  },

  updateAll() {
    for (const editor of atom.workspace.getTextEditors()) {
      this.scrollmaps.get(editor)?.updateView();
    }
  },

  updateTheme() {
    // A UI theme can change the scrollbar width, and the maps are sized against
    // it, so re-measure before the layers read their styles back.
    this.measureScrollbar();
    for (const editor of atom.workspace.getTextEditors()) {
      this.scrollmaps.get(editor)?.updateTheme();
    }
  },

  // Publishes the scrollbar width for the panes that have no editor to ask.
  //
  // The editor strip sizes itself from its own component; `simplemap` draws
  // beside a PDF page or a notebook, where there is no component and no
  // scrollbar of its own to measure, so it takes the width from here.
  //
  // The number comes from the component rather than from a live scrollbar
  // element. The component measures with `overflow: scroll` forced, so it is
  // right even for an editor short enough to show no scrollbar at all --
  // measuring the element there yields 0, which used to leave the variable at
  // 0 and every marker invisible until a longer file was opened.
  measureScrollbar(editor) {
    editor ??= atom.workspace.getActiveTextEditor();
    const width =
      editor?.getElement()?.component?.getVerticalScrollbarWidth() ||
      atom.config.get("scrollmap.overlayWidth");
    if (!width) {
      return;
    }
    const root = document.documentElement;
    const value = `${width}px`;
    // The width almost never moves, and every restyle asks again; writing it
    // back regardless would invalidate the styles of the whole window.
    if (root.style.getPropertyValue("--scrollbar-width") === value) {
      return;
    }
    root.style.setProperty("--scrollbar-width", value);
    root.style.setProperty("--scrollbar-bottom", value);
  },

  provideScrollmapWidget() {
    return require("./simplemap");
  },
};
