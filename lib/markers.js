function resizeCanvas(canvas, width, height) {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

function resolveLength(value, basis, fallback = 0) {
  if (!value || value === "auto") {
    return fallback;
  }
  if (value.endsWith("%")) {
    return (parseFloat(value) / 100) * basis;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getResolver(element) {
  return element.querySelector(".scrollmap-style-resolver");
}

function getStyleProbe(element, className) {
  const resolver = getResolver(element);
  if (!resolver) {
    return null;
  }

  if (!resolver._scrollmapStyleProbes) {
    resolver._scrollmapStyleProbes = new Map();
  }

  let probe = resolver._scrollmapStyleProbes.get(className);
  if (!probe) {
    probe = document.createElement("div");
    probe.className = `${className} scrollmap-style-probe`;
    resolver.appendChild(probe);
    resolver._scrollmapStyleProbes.set(className, probe);
  }
  return probe;
}

function pruneStyleProbes(element, classNames) {
  const resolver = getResolver(element);
  const probes = resolver?._scrollmapStyleProbes;
  if (!probes) {
    return;
  }

  for (const [className, probe] of probes) {
    if (!classNames.has(className)) {
      probe.remove();
      probes.delete(className);
    }
  }
}

function getMarkerStyle(element, className, width, height) {
  const probe = getStyleProbe(element, className);
  if (!probe) {
    return null;
  }

  const computed = getComputedStyle(probe);
  const probeWidth = probe.offsetWidth || resolveLength(computed.width, width, width);
  const probeHeight = probe.offsetHeight || resolveLength(computed.height, height, 1);
  const zIndex = parseInt(computed.zIndex, 10);

  return {
    x: probe.offsetLeft || 0,
    width: Math.max(1, probeWidth),
    minHeight: Math.max(1, resolveLength(computed.minHeight, height, 1)),
    height: Math.max(0, probeHeight),
    color: computed.backgroundColor,
    opacity: Number.isFinite(parseFloat(computed.opacity)) ? parseFloat(computed.opacity) : 1,
    zIndex: Number.isFinite(zIndex) ? zIndex : 0,
  };
}

function drawMarkerRegions(canvas, element, regions, width, height) {
  const ctx = resizeCanvas(canvas, width, height);
  ctx.clearRect(0, 0, width, height);

  const classNames = new Set(regions.map((region) => region.className));
  const styles = new Map();
  for (const className of classNames) {
    styles.set(className, getMarkerStyle(element, className, width, height));
  }
  pruneStyleProbes(element, classNames);

  const sorted = regions
    .map((region, index) => ({ ...region, index, style: styles.get(region.className) }))
    .filter(({ style }) => style && style.color && style.color !== "rgba(0, 0, 0, 0)")
    .sort((a, b) => a.style.zIndex - b.style.zIndex || a.index - b.index);

  for (const region of sorted) {
    const { style } = region;
    const markerHeight = Math.max(style.minHeight, region.height || style.height || 1);
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = style.color;
    ctx.fillRect(style.x, region.y, style.width, markerHeight);
  }
  ctx.globalAlpha = 1;
}

module.exports = {
  drawMarkerRegions,
  getMarkerStyle,
  getStyleProbe,
  pruneStyleProbes,
  resizeCanvas,
  resolveLength,
};
