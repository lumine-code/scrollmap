// The hub's drawing machinery, filled in by `consumeMarkerRegistry`.
//
// The canvas, the style probe and `classNameFor` are the same code on every
// overview map -- that is what makes one stylesheet rule in a layer package
// paint identically everywhere -- and the `marker` package delivers them
// through its service, so this package carries no library dependency. Read
// members at use time, never destructure at load: before the hub arrives they
// are undefined.
module.exports = {
  install(registry) {
    Object.assign(module.exports, registry);
  },
};
