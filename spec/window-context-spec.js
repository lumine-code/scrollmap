describe("scrollbar maps in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("marker");
    await lumine.packages.activatePackage("scrollmap");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("scrollmap");
    await lumine.workspace.discardEditorWindows();
  });
  it("retains its projection and schedules paints in the adopted editor document", async () => {
    const editor = await lumine.workspace.open();
    editor.setText("row\n".repeat(100));
    const main = lumine.packages.getActivePackage("scrollmap").mainModule;
    await conditionPromise(() => !!main.scrollmapForEditor(editor));
    const strip = main.scrollmapForEditor(editor);
    strip.setVisible(true);
    const extra = await lumine.workspace.detachItem(editor);
    expect(main.scrollmapForEditor(editor)).toBe(strip);
    expect(strip.element.ownerDocument).toBe(extra.getDocument());
    expect(strip.domWindow).toBe(extra.getDocument().defaultView);
    await conditionPromise(() => !strip.rafId);
    const frame = spyOn(extra.getDocument().defaultView, "requestAnimationFrame").and.callThrough();
    strip.updateView();
    expect(frame).toHaveBeenCalled();
    await lumine.workspace.attachWindow(extra);
    expect(strip.domWindow).toBe(window);
  });
});
