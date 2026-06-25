const { CompositeDisposable, Disposable } = require("atom");

module.exports = {
  activate() {
    this.providers = new Map();
    this.disposables = new CompositeDisposable();
    const ToggleView = require("./toggle-view");
    this.toggleView = new ToggleView(this);
    this.scrollbarMeasured = false;
    const root = document.documentElement;
    root.style.setProperty("--scrollbar-width", "0");
    root.style.setProperty("--scrollbar-bottom", "0");
    this.disposables.add(
      atom.workspace.observeTextEditors((editor) => {
        this.patchEditor(editor);
      }),
      atom.workspace.onDidChangeActiveTextEditor((editor) => {
        this.measureScrollbar(editor);
      }),
      atom.themes.onDidChangeActiveThemes(() => {
        requestAnimationFrame(() => {
          this.scrollbarMeasured = false;
          this.measureScrollbar();
        });
      }),
      atom.commands.add("atom-workspace", {
        "scrollmap:toggle-layers": () => this.toggleView.toggle(),
      }),
    );
  },

  deactivate() {
    this.providers.clear();
    this.toggleView.destroy();
    this.disposables.dispose();
  },

  patchEditor(editor) {
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
    editor.scrollmap = new Scrollmap(editor);
    for (let [name, props] of this.providers) {
      editor.scrollmap.addLayer(name, props);
    }
    const resizeObserver = new ResizeObserver(() => {
      editor.scrollmap.update();
    });
    resizeObserver.observe(element);
    const disposable = new Disposable(() => {
      resizeObserver.disconnect();
      editor.scrollmap.destroy();
    });
    editor.disposables.add(disposable);
    this.disposables.add(disposable);
    scrollView.parentNode.insertBefore(editor.scrollmap.element, scrollView.nextSibling);
    requestAnimationFrame(() => {
      editor.scrollmap?.update();
    });
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
    root.style.setProperty("--scrollbar-width", `${w || scrollbar.offsetWidth}px`);
    root.style.setProperty("--scrollbar-bottom", `${w}px`);
  },

  addProvider(name, props) {
    if (this.providers.has(name)) {
      return;
    }
    this.providers.set(name, props);
    for (const editor of atom.workspace.getTextEditors()) {
      if (!editor.scrollmap) continue;
      editor.scrollmap.addLayer(name, props);
      editor.scrollmap.update();
    }
  },

  delProvider(name) {
    if (!this.providers.has(name)) {
      return;
    }
    this.providers.delete(name);
    for (const editor of atom.workspace.getTextEditors()) {
      if (!editor.scrollmap) continue;
      editor.scrollmap.delLayer(name);
      editor.scrollmap.updateView();
    }
  },

  consumeScrollmap(provider) {
    this.addProvider(provider.name, provider);
    return new Disposable(() => {
      this.delProvider(provider.name);
    });
  },

  provideSimplemap() {
    return require("./simplemap");
  },
};
