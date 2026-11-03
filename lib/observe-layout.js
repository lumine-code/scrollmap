const { Disposable } = require("lumine");

// Logical scrollbar geometry survives an inactive pane, but CSS probes lose
// their layout while an ancestor is display:none. Watch the rendered box too
// so returning at the same logical size still refreshes its marker styles.
module.exports = function observeLayout(element, onChange) {
  let width = element.clientWidth;
  let height = element.clientHeight;
  let disposed = false;
  const observer = new element.ownerDocument.defaultView.ResizeObserver(() => {
    if (disposed) return;
    const nextWidth = element.clientWidth;
    const nextHeight = element.clientHeight;
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    onChange();
  });
  observer.observe(element);
  return new Disposable(() => {
    disposed = true;
    observer.disconnect();
  });
};
