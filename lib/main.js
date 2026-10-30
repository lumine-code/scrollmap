const { CompositeDisposable, Disposable } = require("lumine");
const toolkit = require("./toolkit");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "scrollmap",
      tips: [
        "{% if keys['scrollmap:toggle'] %}You can show or hide scrollbar markers with {{ 'scrollmap:toggle' | keystroke }}{% else %}You can show or hide scrollbar markers with the Scrollmap: Toggle command.{% endif %}",
      ],
    };
  },

  activate() {
    this.scrollmaps = new WeakMap();
    this.registryConnections = new Map();
    this.connection = null;
    this.consumer = null;
    this.registry = null;
    this.runtimeReady = false;
    this.visible = true;
    // Each strip applies its marker limit to the hub's enabled layers.
    this.filters = {
      scale: lumine.config.get("scrollmap.thresholdScale") ?? 1,
    };
    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "scrollmap:toggle": {
          description: "Show or hide marker strips on editor scrollbars.",
          didDispatch: () => this.toggle(),
        },
      }),
    );
  },

  deactivate() {
    this.disposables?.dispose();
  },

  toggle() {
    if (this.disposables.disposed) return;
    this.visible = !this.visible;
    for (const connection of this.registryConnections.values()) {
      for (const scrollmap of connection.scrollmaps.values()) scrollmap.setVisible(this.visible);
    }
  },

  // Everything that draws lives under the hub consumer: without the `marker`
  // package there are no layers or strips, and the returned
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
        runtimeReady: false,
      };
      this.registryConnections.set(registry, connection);
      connection.consumer.add(
        new Disposable(() => {
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
    // one canvas per open editor does not. Build that UI immediately
    // after activation.
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
    if (this.connection === connection) this.setCurrentRegistry(connection);

    consumer.add(
      registry.onDidChangeItems((layer) => {
        connection.scrollmaps.get(layer.editor)?.updateView();
      }),
      registry.onDidChangeLayers(() => {
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
        const refresh = () => {
          if (editor.getGrammar() === lumine.grammars.nullGrammar) {
            connection.editorDisposables?.get(editor)?.dispose();
          } else this.attachEditor(editor, registry, consumer, connection);
        };
        const subscriptions = new CompositeDisposable(
          editor.onDidChangeGrammar(refresh),
          editor.onDidDestroy(() => {
            subscriptions.dispose();
            consumer.remove(subscriptions);
          }),
        );
        consumer.add(subscriptions);
        refresh();
      }),
    );
    return true;
  },

  attachEditor(editor, registry, consumer = this.consumer, connection = this.connection) {
    if (
      consumer?.disposed ||
      editor.isDestroyed() ||
      editor.getGrammar() === lumine.grammars.nullGrammar
    )
      return;
    const scrollmaps = connection?.scrollmaps ?? this.scrollmaps;
    if (scrollmaps.has(editor)) return;
    const element = editor.getElement();
    if (!element) {
      return;
    }
    const Scrollmap = require("./scrollmap");
    const mode = editor.getBuffer().getLanguageMode();
    const scrollmap = new Scrollmap(editor, registry, this.filters, this.visible);
    if (
      consumer?.disposed ||
      editor.isDestroyed() ||
      editor.getGrammar() === lumine.grammars.nullGrammar ||
      editor.getBuffer().getLanguageMode() !== mode ||
      scrollmaps.has(editor)
    ) {
      scrollmap.destroy();
      return;
    }
    scrollmaps.set(editor, scrollmap);
    let updateFrame, domWindow;
    const stop = () => {
      domWindow?.cancelAnimationFrame(updateFrame);
    };
    const bind = () => {
      stop();
      domWindow = element.ownerDocument.defaultView;
      scrollmap.bindDocument(element.ownerDocument);
      // Populate new layers in the editor's first shared read/paint cycle.
      // The later attachment frame still refreshes size-dependent providers.
      scrollmap.update();
      updateFrame = domWindow.requestAnimationFrame(() => {
        if (!disposable.disposed) scrollmap.update();
      });
    };
    const leases = new CompositeDisposable();
    const disposable = new Disposable(() => {
      leases.dispose();
      stop();
      scrollmap.destroy();
      if (scrollmaps.get(editor) === scrollmap) scrollmaps.delete(editor);
      if (connection?.editorDisposables?.get(editor) === disposable)
        connection.editorDisposables.delete(editor);
      consumer?.remove(disposable);
    });
    leases.add(
      editor.onDidDestroy(() => disposable.dispose()),
      element.onDidAttach(bind),
      element.onDidDetach(stop),
    );
    consumer?.add(disposable);
    if (connection) {
      connection.editorDisposables ??= new Map();
      connection.editorDisposables.set(editor, disposable);
    }
    lumine.scrollbars.getVerticalTrack(element)?.appendChild(scrollmap.element);
    bind();
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
    for (const scrollmap of connection?.scrollmaps.values() ?? []) {
      scrollmap.updateTheme();
    }
  },

  provideScrollmapWidget() {
    return require("./simplemap");
  },
};
