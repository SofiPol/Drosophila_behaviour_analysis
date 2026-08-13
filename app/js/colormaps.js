/* ============================================================================
 * colormaps.js — scientific colour maps (viridis / magma / plasma / standard)
 * Exposed globally as window.ZColormaps.
 * ==========================================================================*/
window.ZColormaps = (function () {
  'use strict';

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const MAPS = {
    viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'].map(hexToRgb),
    magma: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'].map(hexToRgb),
    plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'].map(hexToRgb),
    standard: ['#f7fbff', '#dbe9f6', '#b3cde3', '#8c96c6', '#8856a7', '#810f7c', '#4d004b'].map(hexToRgb)
  };

  function sample(name, t) {
    const stops = MAPS[name] || MAPS.viridis;
    t = Math.max(0, Math.min(1, t));
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    const frac = pos - i;
    const a = stops[i];
    const b = stops[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * frac),
      Math.round(a[1] + (b[1] - a[1]) * frac),
      Math.round(a[2] + (b[2] - a[2]) * frac)
    ];
  }

  function scale(name, n) {
    n = n || 256;
    const out = [];
    for (let i = 0; i < n; i++) {
      const [r, g, b] = sample(name, n === 1 ? 0 : i / (n - 1));
      out.push('rgb(' + r + ',' + g + ',' + b + ')');
    }
    return out;
  }

  function css(name, t) {
    const [r, g, b] = sample(name, t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  return { sample, scale, css, names: Object.keys(MAPS) };
})();
