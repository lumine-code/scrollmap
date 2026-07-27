// Collapse a burst of calls into a single one on the next microtask.
//
// Unlike a throttle, the callback still runs within the task that scheduled it,
// so what it paints lands before the browser's next rendering opportunity. That
// matters for the theme: the swap attaches its stylesheets inside a View
// Transition, which snapshots the whole window -- canvases included -- one frame
// later. A repaint deferred to a timer or an animation frame misses that
// snapshot, and the markers visibly pop to their new colors once the 0.25s
// cross-fade has already finished.
function coalesce(callback) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      callback(...args);
    });
  };
}

module.exports = { coalesce };
