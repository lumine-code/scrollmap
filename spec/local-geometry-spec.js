const { Disposable } = require("lumine");

describe("scrollmap widget local geometry", () => {
  let widget, container, track, geometry, changed, subscription, Simplemap;

  beforeEach(async () => {
    await lumine.packages.activatePackage("marker");
    const main = (await lumine.packages.activatePackage("scrollmap")).mainModule;
    Simplemap = main.provideScrollmapWidget();
    container = document.createElement("div");
    track = document.createElement("div");
    container.appendChild(track);
    jasmine.attachToDOM(container);
    geometry = { verticalSize: 9, viewportHeight: 200 };
    subscription = new Disposable();
    spyOn(subscription, "dispose").and.callThrough();
    spyOn(lumine.scrollbars, "getVerticalTrack").and.returnValue(track);
    spyOn(lumine.scrollbars, "getGeometry").and.callFake(() => geometry);
    spyOn(lumine.scrollbars, "observe").and.callFake((element, callback) => {
      expect(element).toBe(container);
      changed = callback;
      callback(geometry);
      return subscription;
    });
    widget = new Simplemap({ scrollElement: container });
  });

  afterEach(() => {
    widget?.destroy();
    container.remove();
  });

  it("coalesces item bursts into one paint using the latest local geometry", () => {
    const draw = spyOn(widget.canvas, "draw");
    widget.setItems([{ prc: 10 }]);
    widget.setItems([{ prc: 30 }]);
    geometry = { verticalSize: 13, viewportHeight: 300 };
    changed(geometry);
    expect(draw).not.toHaveBeenCalled();
    lumine.views.performDocumentUpdate();
    expect(widget.element.parentNode).toBe(track);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.calls.mostRecent().args[1]).toBe(13);
    expect(draw.calls.mostRecent().args[2]).toBe(300);
    expect(draw.calls.mostRecent().args[0][0].y).toBe(90);
  });

  it("keeps identical item and geometry updates free of canvas work", () => {
    widget.setItems([{ prc: 10 }]);
    lumine.views.performDocumentUpdate();
    const draw = spyOn(widget.canvas, "draw");
    changed(geometry);
    widget.setItems([{ prc: 10 }]);
    lumine.views.performDocumentUpdate();
    expect(draw).not.toHaveBeenCalled();
  });

  it("uses a geometry publication that arrives after its read and before paint", () => {
    const writes = [];
    spyOn(lumine.views, "updateDocument").and.callFake((callback) => {
      writes.push(callback);
      return new Disposable();
    });
    const draw = spyOn(widget.canvas, "draw");
    widget.setItems([{ prc: 50 }]);
    lumine.views.performDocumentUpdate();
    geometry = { verticalSize: 11, viewportHeight: 320 };
    changed(geometry);
    for (const callback of writes) callback();
    expect(draw.calls.mostRecent().args[1]).toBe(11);
    expect(draw.calls.mostRecent().args[2]).toBe(320);
    expect(draw.calls.mostRecent().args[0][0].y).toBe(160);
  });

  it("rejoins a replacement track when the core reports changed geometry", () => {
    lumine.views.performDocumentUpdate();
    const next = document.createElement("div");
    container.appendChild(next);
    lumine.scrollbars.getVerticalTrack.and.returnValue(next);
    changed(geometry);
    lumine.views.performDocumentUpdate();
    expect(widget.element.parentNode).toBe(next);
  });

  it("projects into the shorter vertical track while a horizontal bar occupies the corner", () => {
    const draw = spyOn(widget.canvas, "draw");
    geometry = { verticalSize: 10, viewportHeight: 200, verticalTrackSize: 190 };
    changed(geometry);
    widget.setItems([{ prc: 100 }]);
    lumine.views.performDocumentUpdate();
    expect(draw.calls.mostRecent().args[2]).toBe(190);
    expect(draw.calls.mostRecent().args[0][0].y).toBe(190);
    expect(widget.element.style.height).toBe("190px");
    geometry = { ...geometry, verticalTrackSize: 200 };
    changed(geometry);
    lumine.views.performDocumentUpdate();
    expect(draw.calls.mostRecent().args[2]).toBe(200);
  });

  it("releases the observer and cancels a queued paint on destruction", () => {
    const draw = spyOn(widget.canvas, "draw");
    widget.setItems([{ prc: 10 }]);
    widget.destroy();
    changed(geometry);
    lumine.views.performDocumentUpdate();
    expect(subscription.dispose).toHaveBeenCalledTimes(1);
    expect(draw).not.toHaveBeenCalled();
    expect(widget.element.parentNode).toBeNull();
  });
});
