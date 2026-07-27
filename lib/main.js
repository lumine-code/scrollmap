const { CompositeDisposable, Disposable } = require("atom");
const { LayerHost, coalesce } = require("@lumine-code/marker-host");
const { LayerPicker } = require("@lumine-code/marker-host/picker");

module.exports = {
  activate() {
    this.scrollmaps = new WeakMap();
    this.disposables = new CompositeDisposable();

    this.host = new LayerHost({
      name: "scrollmap",
      disabledKey: "scrollmap.disabledLayers",
      thresholdScaleKey: "scrollmap.thresholdScale",
      onItemsChanged: (layer) => {
        this.scrollmaps.get(layer.editor)?.updateView();
      },
      onLayersChanged: () => {
        for (const editor of atom.workspace.getTextEditors()) {
          this.scrollmaps.get(editor)?.updateView();
        }
      },
    });

    this.picker = new LayerPicker({
      host: this.host,
      className: "scrollmap-view",
      emptyMessage: "No scrollmap layers found",
    });

    const root = document.documentElement;
    root.style.setProperty("--scrollbar-width", "0");
    root.style.setProperty("--scrollbar-bottom", "0");
    // Coalesced rather than throttled: the bursts have to be answered within the
    // task that raised them. See `coalesce` in the marker host.
    const updateTheme = coalesce(() => this.updateTheme());
    this.disposables.add(
      atom.workspace.observeTextEditors((editor) => {
        this.attachEditor(editor);
      }),
      atom.workspace.onDidChangeActiveTextEditor((editor) => {
        this.measureScrollbar(editor);
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
      atom.commands.add("atom-workspace", {
        "scrollmap:toggle-layers": () => this.picker.show(),
      }),
    );
  },

  deactivate() {
    this.picker.destroy();
    this.disposables.dispose();
    this.host.destroy();
  },

  attachEditor(editor) {
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
    const scrollmap = new Scrollmap(editor, this.host);
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
      this.disposables.remove(disposable);
      disposable.dispose();
    });
    this.disposables.add(disposable);
    scrollView.parentNode.insertBefore(scrollmap.element, scrollView.nextSibling);
    requestAnimationFrame(() => {
      scrollmap.update();
    });
  },

  scrollmapForEditor(editor) {
    return this.scrollmaps.get(editor);
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
    const width = editor?.getElement()?.component?.getVerticalScrollbarWidth();
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

  consumeMarkerLayer(provider) {
    return this.host.addProvider(provider);
  },

  provideScrollmapWidget() {
    return require("./simplemap");
  },
};
