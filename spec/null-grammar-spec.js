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
});
