describe("scrollmap marker positions across inactive editors", () => {
  let main, marker, registrations, sheets;

  const positions = ["left", undefined, "right", "full"];

  async function frames(count = 6) {
    for (let index = 0; index < count; index++) await new Promise(requestAnimationFrame);
  }

  async function openEditor() {
    const editor = await lumine.workspace.open();
    editor.setText("position fixture\n".repeat(200));
    await frames();
    return editor;
  }

  function provide(name, offset = 0, length = 20) {
    const registration = marker.consumeMarkerLayer({
      name,
      getItems: () =>
        positions.map((position, index) => ({
          row: index * 40 + offset,
          end: index * 40 + offset + length,
          position,
        })),
    });
    registrations.push(registration);
    sheets.push(
      lumine.styles.addStyleSheet(`.marker.marker-${name} { background: rgb(255, 0, 0); }`),
    );
  }

  function expectPositions(editor, name, opacity = 1) {
    const map = main.scrollmapForEditor(editor);
    const canvas = map.element.querySelector("canvas");
    const geometry = lumine.scrollbars.getGeometry(editor.getElement());
    const scale = (geometry.verticalTrackSize ?? geometry.viewportHeight) / geometry.scrollHeight;
    const regions = [];
    map.regionsFor(
      map.handle.layerFor(name),
      scale,
      editor.component.getLineHeight() * scale,
      regions,
    );
    const ratio = canvas.height / (geometry.verticalTrackSize ?? geometry.viewportHeight);
    const context = canvas.getContext("2d");
    const ink = (x, region) =>
      context.getImageData(x, Math.floor((region.y + region.height / 2) * ratio), 1, 1).data[3] > 0;
    const middle = Math.floor(canvas.width / 2);
    const last = canvas.width - 1;
    expect(
      regions.map((region) => [ink(0, region), ink(middle, region), ink(last, region)]),
    ).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, true],
    ]);
    for (const [index, region] of regions.entries()) {
      const x = index === 2 ? last : index === 1 ? middle : 0;
      const pixel = context.getImageData(
        x,
        Math.floor((region.y + region.height / 2) * ratio),
        1,
        1,
      ).data;
      expect(Array.from(pixel).slice(0, 3)).toEqual([255, 0, 0]);
      expect(pixel[3] / 255).toBeCloseTo(opacity, 2);
    }
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    const workspace = lumine.workspace.getElement();
    workspace.style.width = "800px";
    workspace.style.height = "600px";
    jasmine.attachToDOM(workspace);
    await lumine.packages.activatePackage("language-text");
    lumine.config.set("marker.cursors.enabled", false);
    marker = (await lumine.packages.activatePackage("marker")).mainModule;
    main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    registrations = [];
    sheets = [];
  });

  afterEach(() => {
    for (const registration of registrations) registration.dispose();
    for (const sheet of sheets) sheet.dispose();
  });

  it("paints all four positions after their first update happened in an inactive tab", async () => {
    const first = await openEditor();
    const pane = lumine.workspace.getActivePane();
    const second = await openEditor();
    expect(first.getElement().clientWidth).toBe(0);
    provide("initial-positions");
    await frames();

    pane.activateItem(first);
    await frames();
    const right = pane.splitRight();
    pane.moveItemToPane(second, right);
    right.activateItem(second);
    await frames();

    expectPositions(first, "initial-positions");
    expectPositions(second, "initial-positions");
  });

  it("refreshes new marker classes and restyles applied while a same-size tab is hidden", async () => {
    const first = await openEditor();
    const pane = lumine.workspace.getActivePane();
    provide("existing-positions");
    await frames();
    expectPositions(first, "existing-positions");
    const before = lumine.scrollbars.getGeometry(first.getElement());
    await openEditor();
    provide("new-positions", 21, 18);
    sheets.push(
      lumine.styles.addStyleSheet(
        ".scrollmap .marker.marker-existing-positions { opacity: 0.75; }",
      ),
    );
    await frames();

    pane.activateItem(first);
    await frames();

    const after = lumine.scrollbars.getGeometry(first.getElement());
    expect(after.verticalSize).toBe(before.verticalSize);
    expect(after.verticalTrackSize).toBe(before.verticalTrackSize);
    expectPositions(first, "existing-positions", 0.75);
    expectPositions(first, "new-positions");
  });
});
