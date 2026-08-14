/**
 * @fileoverview Earthquake Browser — USGS FDSN API Query Engine
 *
 * @description
 * Fetches global M≥6.5 earthquakes from the USGS Earthquake Hazards Program
 * FDSN Event Web Service API and presents them as a scrollable interactive list
 * in the platform's left sidebar. Provides a hardcoded fallback list of landmark
 * historical earthquakes if the API request fails (e.g. offline environments).
 *
 * When a user clicks an event, the selected earthquake scenario is broadcast
 * globally so the hazard engine can recompute PGA and damage distributions.
 *
 * @methodology
 * REST API query targeting USGS FDSN endpoint with parameters:
 *   - format=geojson, minmagnitude=6.5, limit=50, orderby=magnitude
 * Response is parsed for id, title, magnitude, coordinates, and depth.
 * A custom 'earthquake:selected' CustomEvent is dispatched on window.
 *
 * @references
 * - USGS FDSN Event Web Service API Documentation:
 *   https://earthquake.usgs.gov/fdsnws/event/1/
 * - Incorporated Research Institutions for Seismology (IRIS) FDSN Standards.
 * - Dziewonski, A.M. et al. (1981). Determination of earthquake source parameters
 *   from waveform data. J. Geophysical Research, 86, 2825-2852.
 *
 * @author GeoAI Research Lab, IIT Kharagpur
 * @version 2.0.0
 */

'use strict';

/** USGS FDSN API endpoint URL (no CDN — pure HTTPS API call) */
const USGS_API_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query?' +
  'format=geojson&minmagnitude=6.5&limit=50&orderby=magnitude';

/**
 * Hardcoded fallback earthquake list for offline/restricted network environments.
 * Covers landmark events that shaped seismic engineering knowledge.
 * @type {Array<EarthquakeRecord>}
 */
const FALLBACK_EARTHQUAKES = [
  { id: 'fb_1', title: '2023 Kahramanmaraş', mag: 7.8, place: 'Central Turkey',
    lat: 37.17, lon: 37.03, depth: 10, year: 2023 },
  { id: 'fb_2', title: '2021 Haiti', mag: 7.2, place: 'Haiti (Nippes)',
    lat: 18.37, lon: -73.47, depth: 10, year: 2021 },
  { id: 'fb_3', title: '2015 Nepal (Gorkha)', mag: 7.8, place: 'Nepal',
    lat: 28.23, lon: 84.73, depth: 15, year: 2015 },
  { id: 'fb_4', title: '2011 Tōhoku', mag: 9.0, place: 'Pacific Ocean, Japan',
    lat: 38.30, lon: 142.37, depth: 29, year: 2011 },
  { id: 'fb_5', title: '2010 Haiti', mag: 7.0, place: 'Haiti',
    lat: 18.44, lon: -72.57, depth: 13, year: 2010 },
  { id: 'fb_6', title: '2008 Sichuan', mag: 7.9, place: 'Sichuan, China',
    lat: 31.00, lon: 103.32, depth: 19, year: 2008 },
  { id: 'fb_7', title: '2004 Sumatra–Andaman', mag: 9.1, place: 'Indian Ocean',
    lat: 3.30, lon: 95.98, depth: 30, year: 2004 },
  { id: 'fb_8', title: '2001 Gujarat (Bhuj)', mag: 7.7, place: 'Gujarat, India',
    lat: 23.40, lon: 70.23, depth: 16, year: 2001 },
  { id: 'fb_9', title: '1999 İzmit (Kocaeli)', mag: 7.6, place: 'Türkiye',
    lat: 40.77, lon: 29.99, depth: 17, year: 1999 }
];

/**
 * @typedef {Object} EarthquakeRecord
 * @property {string} id    - Unique event identifier
 * @property {string} title - Human-readable event name
 * @property {number} mag   - Moment magnitude Mw
 * @property {string} place - Location description
 * @property {number} lat   - Epicenter latitude
 * @property {number} lon   - Epicenter longitude
 * @property {number} depth - Focal depth (km)
 * @property {number} year  - Event year
 */

/**
 * Fetches earthquake data from USGS FDSN API with a timeout.
 * Falls back to FALLBACK_EARTHQUAKES on network failure.
 *
 * @param {number} [timeoutMs=6000] - Request timeout in milliseconds
 * @returns {Promise<{ events: EarthquakeRecord[], source: 'usgs'|'fallback' }>}
 */
async function fetchEarthquakes(timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(USGS_API_URL, { signal: controller.signal });
    clearTimeout(tid);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const geojson = await resp.json();

    const events = geojson.features.map(f => {
      const p = f.properties;
      const [lon, lat, depth] = f.geometry.coordinates;
      return {
        id:    f.id,
        title: p.title || p.place,
        mag:   p.mag,
        place: p.place,
        lat, lon,
        depth: depth || 10,
        year:  p.time ? new Date(p.time).getFullYear() : 0
      };
    });

    return { events, source: 'usgs' };
  } catch (err) {
    console.warn('[EarthquakeBrowser] USGS API failed:', err.message, '— using fallback list.');
    return { events: FALLBACK_EARTHQUAKES, source: 'fallback' };
  }
}

/**
 * Renders the earthquake list into a container element.
 * Attaches click handlers that dispatch 'earthquake:selected' CustomEvents.
 *
 * @param {EarthquakeRecord[]} events     - Array of earthquake records
 * @param {HTMLElement}        container  - Target DOM container
 * @param {string}             source     - 'usgs' or 'fallback'
 */
function renderEarthquakeList(events, container, source) {
  container.innerHTML = '';

  // Source badge
  const badge = document.createElement('div');
  badge.className = 'eq-source-badge';
  badge.textContent = source === 'usgs'
    ? `✓ USGS Live — ${events.length} events`
    : '⚠ Offline — Landmark Events';
  badge.style.cssText = `font-size:.65rem;padding:4px 8px;border-radius:6px;margin-bottom:8px;
    background:${source === 'usgs' ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.15)'};
    color:${source === 'usgs' ? '#10b981' : '#f59e0b'};
    border:1px solid ${source === 'usgs' ? '#10b981' : '#f59e0b'};text-align:center;`;
  container.appendChild(badge);

  events.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'eq-item';
    item.dataset.id = ev.id;

    const magColor = ev.mag >= 8.0 ? '#ef4444'
      : ev.mag >= 7.5 ? '#f97316'
      : ev.mag >= 7.0 ? '#f59e0b'
      : '#10b981';

    item.innerHTML = `
      <div class="eq-mag" style="color:${magColor}">M${ev.mag.toFixed(1)}</div>
      <div class="eq-info">
        <div class="eq-title">${ev.title}</div>
        <div class="eq-meta">${ev.year || ''} · ${ev.lat.toFixed(2)}°N ${ev.lon.toFixed(2)}°E · ${ev.depth}km</div>
      </div>`;

    item.addEventListener('click', () => {
      // Highlight selected
      container.querySelectorAll('.eq-item').forEach(el => el.classList.remove('eq-selected'));
      item.classList.add('eq-selected');

      // Broadcast selection
      window.dispatchEvent(new CustomEvent('earthquake:selected', { detail: ev }));
    });

    container.appendChild(item);
  });
}

/**
 * Initialises the earthquake browser panel.
 * Fetches data and renders into the given container element.
 *
 * @param {HTMLElement} container - Target DOM element for the list
 * @returns {Promise<void>}
 */
async function initEarthquakeBrowser(container) {
  container.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7ea0;font-size:.8rem;">Loading earthquakes…</div>';
  const { events, source } = await fetchEarthquakes();
  renderEarthquakeList(events, container, source);
}

// ── Exports ──────────────────────────────────────────────────────────────────
window.EarthquakeBrowser = {
  fetchEarthquakes,
  renderEarthquakeList,
  initEarthquakeBrowser,
  FALLBACK_EARTHQUAKES
};
