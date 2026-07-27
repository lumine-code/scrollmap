const { CompositeDisposable, Disposable } = require("atom");
const { LayerHost, coalesce } = require("@lumine-code/marker-host");

module.exports = {
  activate() {
    this.scrollmaps = new WeakMap();
    this.disposables = new CompositeDisposable();
    this.scrollbarMeasured = false;

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

    const ToggleView = require("./toggle-view");
    this.toggleView = new ToggleView(this.host);

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
        "scrollmap:toggle-layers": () => this.toggleView.toggle(),
      }),
    );
  },

  deactivate() {
    this.toggleView.destroy();
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
    this.scrollbarMeasured = false;
    this.measureScrollbar();
    for (const editor of atom.workspace.getTextEditors()) {
      this.scrollmaps.get(editor)?.updateTheme();
    }
  },

  measureScrollbar(editor) {
    if (this.scrollbarMeasured) return;
    if (!editor) {
      editor = atom.workspace.getActiveTextEditor();
    }
    if (!editor) return;
    const scrollbar = editor?.getElement()?.querySelector(".vertical-scrollbar");
    if (!scrollbar) return;
    const w = scrollbar.offsetWidth - scrollbar.clientWidth;
    if (!w) return;
    this.scrollbarMeasured = true;
    const root = document.documentElement;
    const width = `${w}px`;
    // Every restyle re-measures, and the width almost never moves; writing it
    // back regardless would invalidate the styles of the whole window.
    if (root.style.getPropertyValue("--scrollbar-width") === width) {
      return;
    }
    root.style.setProperty("--scrollbar-width", width);
    root.style.setProperty("--scrollbar-bottom", width);
  },

  consumeMarkerLayer(provider) {
    return this.host.addProvider(provider);
  },

  provideScrollmapWidget() {
    return require("./simplemap");
  },
};
