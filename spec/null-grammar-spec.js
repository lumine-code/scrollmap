const path = require("node:path");

describe("scrollmap with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage(path.join(__dirname, "..", "..", "marker"));
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.nullGrammar);
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("scrollmap");
  });

  it("removes the strip and subscriptions, then rebuilds for a grammar", () => {
    expect(main.scrollmapForEditor(editor)).toBeUndefined();
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    const strip = main.scrollmapForEditor(editor);
    expect(strip).toBeDefined();
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(main.scrollmapForEditor(editor)).toBeUndefined();
    expect(strip.element.isConnected).toBe(false);
    editor.setGrammar(grammar);
    expect(main.scrollmapForEditor(editor)).toBeDefined();
    expect(main.scrollmapForEditor(editor)).not.toBe(strip);
  });

  for (const restoreDuringAttachment of [false, true])
    it(`does not publish an obsolete strip when a provider selects None during attachment (restore=${restoreDuringAttachment})`, () => {
      const marker = lumine.packages.getActivePackage("marker").mainModule;
      const grammar = lumine.grammars.grammarForScopeName("text.plain");
      let changed = false;
      const registration = marker.consumeMarkerLayer({
        name: "none-during-scrollmap-attachment",
        initialize(layer) {
          if (changed || layer.editor !== editor) return;
          changed = true;
          editor.setGrammar(lumine.grammars.nullGrammar);
          if (restoreDuringAttachment) editor.setGrammar(grammar);
        },
        getItems: () => [],
      });
      try {
        editor.setGrammar(grammar);
        expect(changed).toBe(true);
        if (!restoreDuringAttachment) {
          expect(main.scrollmapForEditor(editor)).toBeUndefined();
          expect(editor.element.querySelectorAll(".scrollmap").length).toBe(0);
          editor.setGrammar(grammar);
        }
        expect(main.scrollmapForEditor(editor)).toBeDefined();
        expect(editor.element.querySelectorAll(".scrollmap").length).toBe(1);
        editor.setGrammar(lumine.grammars.nullGrammar);
        expect(main.scrollmapForEditor(editor)).toBeUndefined();
        expect(editor.element.querySelectorAll(".scrollmap").length).toBe(0);
      } finally {
        registration.dispose();
      }
    });
});
