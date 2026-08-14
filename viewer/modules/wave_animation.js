/**
 * @fileoverview Ground Motion Wave Propagation Animation Engine
 *
 * @description
 * Renders an animated seismic wave propagation simulation on an HTML5 Canvas
 * overlay using requestAnimationFrame. Visualises three distinct seismic wave
 * phases: P-waves (primary/compressional), S-waves (secondary/shear), and
 * surface waves (Rayleigh/Love), each propagating at physically motivated
 * radial velocities derived from simplified crustal velocity models.
 *
 * The animation originates from the epicenter (projected to screen center) and
 * shows attenuating concentric wavefronts with colour-coded phases and a
 * companion legend panel.
 *
 * @methodology
 * Wave propagation is simplified as radially expanding concentric rings on a
 * 2D screen plane. Phase velocities are scaled to produce visually informative
 * animations rather than strict physical simulations:
 *   - P-wave velocity: ~6.0 km/s (fast compressional, blue wavefront)
 *   - S-wave velocity: ~3.5 km/s (slower shear, orange wavefront)
 *   - Surface velocity: ~2.0 km/s (slowest, red wavefront — highest damage)
 *
 * Multiple wavefronts are emitted from the epicenter at staggered time offsets
 * to create the pulsing effect. Opacity decays with radius (geometric spreading).
 *
 * @references
 * - Sherrif, R.E. & Geldart, L.P. (1995). Exploration Seismology (2nd ed).
 *   Cambridge University Press.
 * - Lay, T. & Wallace, T.C. (1995). Modern Global Seismology. Academic Press.
 * - Stein, S. & Wysession, M. (2003). An Introduction to Seismology, Earthquakes,
 *   and Earth Structure. Blackwell Publishing.
 *
 * @author GeoAI Research Lab, IIT Kharagpur
 * @version 2.0.0
 */

'use strict';

/**
 * Wave type definitions: name, colour, relative screen velocity, description.
 * @type {Array<WaveType>}
 *
 * @typedef {Object} WaveType
 * @property {string} name     - Wave phase name
 * @property {string} color    - Stroke colour (CSS)
 * @property {string} fill     - Glow fill colour (CSS, semi-transparent)
 * @property {number} speed    - Screen pixels per second (relative)
 * @property {string} desc     - Brief description for legend
 * @property {number} offset   - Time offset (ms) before this phase begins
 */
const WAVE_TYPES = [
  {
    name:   'P-wave',
    color:  '#00aaff',
    fill:   'rgba(0,170,255,0.06)',
    speed:  220,   // px/s on screen
    desc:   'Primary / Compressional (~6 km/s)',
    offset: 0
  },
  {
    name:   'S-wave',
    color:  '#ff9900',
    fill:   'rgba(255,153,0,0.07)',
    speed:  140,
    desc:   'Secondary / Shear (~3.5 km/s)',
    offset: 600
  },
  {
    name:   'Surface',
    color:  '#ff3b3b',
    fill:   'rgba(255,59,59,0.09)',
    speed:  85,
    desc:   'Surface Waves / Rayleigh (~2 km/s)',
    offset: 1400
  }
];

/**
 * @typedef {Object} WaveAnimState
 * @property {boolean}       running      - Whether animation is active
 * @property {number|null}   rafId        - requestAnimationFrame handle
 * @property {HTMLCanvasElement} canvas   - Overlay canvas element
 * @property {CanvasRenderingContext2D} ctx - 2D context
 * @property {number}        startTime    - Performance timestamp of animation start
 * @property {number}        cx           - Epicenter X (screen px)
 * @property {number}        cy           - Epicenter Y (screen px)
 */

/** Module-level animation state */
const _state = {
  running: false,
  rafId:   null,
  canvas:  null,
  ctx:     null,
  startTime: 0,
  cx: 0,
  cy: 0
};

/** Interval between successive wavefront rings (ms) */
const RING_INTERVAL_MS = 900;

/** Maximum wavefront radius before ring is retired (px) */
const MAX_RADIUS_FACTOR = 1.5; // × Math.max(screenW, screenH)

/**
 * Computes the radius and opacity of a single wavefront ring.
 *
 * @param {number} elapsed - Time since animation start (ms)
 * @param {number} ringAge - Time since this ring was emitted (ms)
 * @param {number} speed   - Screen pixels per second
 * @param {number} maxR    - Maximum radius (px)
 * @returns {{ radius: number, alpha: number }}
 */
function ringState(elapsed, ringAge, speed, maxR) {
  const radius = (ringAge / 1000) * speed;
  const alpha  = Math.max(0, 1 - radius / maxR) * 0.85;
  return { radius, alpha };
}

/**
 * Draws a single wavefront ring on the canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx     - Center X
 * @param {number} cy     - Center Y
 * @param {number} radius - Ring radius (px)
 * @param {number} alpha  - Opacity [0,1]
 * @param {WaveType} wt   - Wave type descriptor
 */
function drawRing(ctx, cx, cy, radius, alpha, wt) {
  if (radius < 1 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Filled disc (very subtle)
  const grad = ctx.createRadialGradient(cx, cy, Math.max(0, radius - 20), cx, cy, radius);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, wt.fill.replace(/[\d.]+\)$/, `${alpha * 0.5})`));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Leading edge stroke
  ctx.strokeStyle = wt.color;
  ctx.lineWidth   = 2.2;
  ctx.shadowColor = wt.color;
  ctx.shadowBlur  = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws the wave type legend in the top-right corner of the canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasW
 * @param {number} canvasH
 */
function drawLegend(ctx, canvasW, canvasH) {
  const x = canvasW - 260;
  const y = canvasH - 115;
  const pad = 12;

  // Background panel
  ctx.save();
  ctx.fillStyle   = 'rgba(8,12,24,0.85)';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(x - pad, y - pad, 260, 105, 10);
  ctx.fill();
  ctx.stroke();

  // Title
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font      = 'bold 10px system-ui, sans-serif';
  ctx.fillText('SEISMIC WAVE PHASES', x, y + 2);

  WAVE_TYPES.forEach((wt, i) => {
    const ly = y + 22 + i * 24;
    // Colour dot
    ctx.fillStyle = wt.color;
    ctx.beginPath();
    ctx.arc(x + 6, ly, 5, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font      = 'bold 11px system-ui, sans-serif';
    ctx.fillText(wt.name, x + 18, ly + 4);

    // Description
    ctx.fillStyle = 'rgba(180,200,220,0.6)';
    ctx.font      = '10px system-ui, sans-serif';
    ctx.fillText(wt.desc, x + 18, ly + 16);
  });

  ctx.restore();
}

/**
 * Draws the epicenter marker at the origin point.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} elapsed - ms since start (for pulsing)
 */
function drawEpicenter(ctx, cx, cy, elapsed) {
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.006);

  ctx.save();
  // Outer glow
  ctx.globalAlpha = 0.5 * pulse;
  ctx.fillStyle   = '#ef4444';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur  = 30;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fill();

  // Inner star
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = '#ff5c5c';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  // Cross-hair lines
  ctx.strokeStyle = 'rgba(255,92,92,0.7)';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 22, cy); ctx.lineTo(cx + 22, cy);
  ctx.moveTo(cx, cy - 22); ctx.lineTo(cx, cy + 22);
  ctx.stroke();

  ctx.restore();
}

/**
 * Main animation loop — called each frame by requestAnimationFrame.
 *
 * @param {number} timestamp - DOMHighResTimeStamp from rAF
 */
function _animLoop(timestamp) {
  if (!_state.running) return;

  const { canvas, ctx, startTime, cx, cy } = _state;
  const elapsed = timestamp - startTime;
  const maxR    = MAX_RADIUS_FACTOR * Math.max(canvas.width, canvas.height);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw each wave type
  WAVE_TYPES.forEach(wt => {
    const waveStart = startTime + wt.offset;
    if (timestamp < waveStart) return;
    const waveElapsed = timestamp - waveStart;

    // Emit multiple rings at RING_INTERVAL_MS intervals
    const ringCount = Math.floor(waveElapsed / RING_INTERVAL_MS) + 1;
    for (let r = 0; r < ringCount; r++) {
      const ringAge = waveElapsed - r * RING_INTERVAL_MS;
      if (ringAge < 0) continue;
      const { radius, alpha } = ringState(elapsed, ringAge, wt.speed, maxR);
      if (radius > maxR) continue;
      drawRing(ctx, cx, cy, radius, alpha, wt);
    }
  });

  drawEpicenter(ctx, cx, cy, elapsed);
  drawLegend(ctx, canvas.width, canvas.height);

  _state.rafId = requestAnimationFrame(_animLoop);
}

/**
 * Starts the wave animation on the given canvas overlay.
 * Positions the epicenter at the canvas center by default,
 * or at optional (cx, cy) coordinates.
 *
 * @param {HTMLCanvasElement} canvas - Overlay canvas element
 * @param {number} [cx]              - Epicenter X (defaults to canvas center)
 * @param {number} [cy]              - Epicenter Y (defaults to canvas center)
 */
function startWaveAnimation(canvas, cx, cy) {
  if (_state.running) stopWaveAnimation();

  _state.canvas    = canvas;
  _state.ctx       = canvas.getContext('2d');
  _state.cx        = cx !== undefined ? cx : canvas.width  / 2;
  _state.cy        = cy !== undefined ? cy : canvas.height / 2;
  _state.running   = true;
  _state.startTime = performance.now();

  _state.rafId = requestAnimationFrame(_animLoop);
}

/**
 * Stops the wave animation and clears the canvas.
 */
function stopWaveAnimation() {
  _state.running = false;
  if (_state.rafId) {
    cancelAnimationFrame(_state.rafId);
    _state.rafId = null;
  }
  if (_state.ctx && _state.canvas) {
    _state.ctx.clearRect(0, 0, _state.canvas.width, _state.canvas.height);
  }
}

/**
 * Returns whether the animation is currently running.
 * @returns {boolean}
 */
function isRunning() { return _state.running; }

// ── Exports ──────────────────────────────────────────────────────────────────
window.WaveAnimation = { startWaveAnimation, stopWaveAnimation, isRunning, WAVE_TYPES };
