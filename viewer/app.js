/**
 * GeoAI Live Earthquake Digital Twin - CesiumJS Renderer & Interactive Controller
 */

let viewer;
let buildingEntities = [];
let geojsonRawData = null;
let currentViewerState = 'before';
let activeFilter = 'ALL';

// Antakya study area centre: lon=36.160, lat=36.208 (Turkey)
const STUDY_LON = 36.160;
const STUDY_LAT = 36.208;

const DAMAGE_COLORS = {
  none:      Cesium.Color.fromCssColorString('#10b981').withAlpha(0.95),
  slight:    Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.95),
  moderate:  Cesium.Color.fromCssColorString('#f97316').withAlpha(0.95),
  extensive: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.95),
  collapse:  Cesium.Color.fromCssColorString('#7f1d1d').withAlpha(0.98),
  neutral:   Cesium.Color.fromCssColorString('#4a90d9').withAlpha(0.90)
};

function initCesiumViewer() {
  Cesium.Ion.defaultAccessToken = '';

  viewer = new Cesium.Viewer('cesiumContainer', {
    imageryProvider: new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maximumLevel: 19,
      credit: 'OpenStreetMap'
    }),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    selectionIndicator: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false
  });

  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;

  // Point camera at Antakya from bird's-eye
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(STUDY_LON, STUDY_LAT, 4500),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch:   Cesium.Math.toRadians(-55),
      roll:    0
    }
  });

  setupEntityClickHandler();
}

function loadDigitalTwinData() {
  if (window.DIGITAL_TWIN_DATA && window.DIGITAL_TWIN_DATA.features && window.DIGITAL_TWIN_DATA.features.length > 0) {
    geojsonRawData = window.DIGITAL_TWIN_DATA;
    console.log('[Viewer] Loaded', geojsonRawData.features.length, 'buildings from embedded bundle.');
  } else {
    console.warn('[Viewer] Bundle not found — using fallback synthetic data.');
    geojsonRawData = generateFallbackGeoJSON();
  }

  render3DBuildings();
  updateSummaryStatistics();

  // Auto-zoom to actual building bounding box after entities are added
  setTimeout(() => {
    if (buildingEntities.length > 0) {
      viewer.zoomTo(
        viewer.entities,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(0),
          Cesium.Math.toRadians(-55),
          3000
        )
      );
    }
  }, 800);
}

function render3DBuildings() {
  if (!geojsonRawData || !geojsonRawData.features) return;

  buildingEntities.forEach(e => viewer.entities.remove(e));
  buildingEntities = [];

  geojsonRawData.features.forEach((feature) => {
    const props = feature.properties;
    const ring  = feature.geometry.coordinates[0];

    // GeoJSON: [longitude, latitude] order
    const flat = [];
    ring.forEach(pt => { flat.push(pt[0], pt[1]); });

    const origH = props.height_m || 12.0;
    const state = props.predicted_damage_state || 'none';

    let extH  = origH;
    let color = DAMAGE_COLORS.neutral;

    if (currentViewerState === 'after') {
      color = DAMAGE_COLORS[state] || DAMAGE_COLORS.none;
      if (state === 'collapse')  extH = origH * 0.25;
      else if (state === 'extensive') extH = origH * 0.65;
    }

    const ent = viewer.entities.add({
      name: props.building_id,
      polygon: {
        hierarchy:      Cesium.Cartesian3.fromDegreesArray(flat),
        height:         0,
        extrudedHeight: extH,
        material:       color,
        outline:        true,
        outlineColor:   Cesium.Color.BLACK.withAlpha(0.7)
      },
      properties: props
    });

    if (activeFilter !== 'ALL' && state !== activeFilter) ent.show = false;
    buildingEntities.push(ent);
  });

  viewer.scene.requestRender();
}

function setViewerState(state) {
  currentViewerState = state;
  document.getElementById('btnBefore').classList.toggle('active', state === 'before');
  document.getElementById('btnAfter').classList.toggle('active', state === 'after');
  render3DBuildings();
}

function applyDamageFilter(filterState) {
  activeFilter = filterState;
  buildingEntities.forEach(entity => {
    const props = entity.properties;
    const ds = props.predicted_damage_state ? props.predicted_damage_state.getValue() : 'none';
    entity.show = (filterState === 'ALL' || ds === filterState);
  });
  viewer.scene.requestRender();
}

function updateSummaryStatistics() {
  if (!geojsonRawData || !geojsonRawData.features) return;
  const counts = { none: 0, slight: 0, moderate: 0, extensive: 0, collapse: 0 };
  geojsonRawData.features.forEach(f => {
    const ds = f.properties.predicted_damage_state || 'none';
    if (counts[ds] !== undefined) counts[ds]++;
  });
  document.getElementById('countNone').innerText = counts.none;
  document.getElementById('countSlight').innerText = counts.slight;
  document.getElementById('countModerate').innerText = counts.moderate;
  document.getElementById('countExtensive').innerText = counts.extensive;
  document.getElementById('countCollapse').innerText = counts.collapse;
}

function setupEntityClickHandler() {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene);
  handler.setInputAction(function (click) {
    const pickedObject = viewer.scene.pick(click.position);
    if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
      const entity = pickedObject.id;
      const props  = entity.properties;
      buildingEntities.forEach(e => e.polygon.outlineColor = Cesium.Color.BLACK.withAlpha(0.7));
      entity.polygon.outlineColor = Cesium.Color.CYAN;
      displayBuildingInspectionCard(props);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function displayBuildingInspectionCard(props) {
  const get = (key, def) => props[key] ? props[key].getValue() : def;
  const bldgId   = get('building_id', 'N/A');
  const heightM  = get('height_m', 12.0);
  const heightSrc= get('height_source', 'assumed');
  const stype    = get('structural_type', 'N/A');
  const stypeSrc = get('structural_type_source', 'assumed');
  const pgaG     = get('pga_g', 0.46);
  const predState= get('predicted_damage_state', 'none');
  const gtState  = get('ground_truth_damage_state', 'N/A');
  const probs    = get('damage_state_probs', {});

  document.getElementById('drawerBody').innerHTML = `
    <div class="bldg-card">
      <div class="bldg-title">${bldgId}</div>
      <div class="prop-grid">
        <div class="prop-item">
          <span class="p-label">PREDICTED DAMAGE</span>
          <span class="p-val damage-badge ${predState}">${predState}</span>
        </div>
        <div class="prop-item">
          <span class="p-label">SATELLITE GROUND TRUTH</span>
          <span class="p-val damage-badge ${gtState}">${gtState}</span>
        </div>
        <div class="prop-item">
          <span class="p-label">SEISMIC DEMAND (PGA)</span>
          <span class="p-val">${pgaG.toFixed(3)} g</span>
        </div>
        <div class="prop-item">
          <span class="p-label">HEIGHT / STORIES</span>
          <span class="p-val">${heightM.toFixed(1)} m (~${Math.round(heightM/3)} st)</span>
        </div>
      </div>
      <div class="probs-container">
        <h4>Damage State Probability Distribution</h4>
        ${renderProbabilityBar('None',      probs.none      || 0, 'var(--ds-none)')}
        ${renderProbabilityBar('Slight',    probs.slight    || 0, 'var(--ds-slight)')}
        ${renderProbabilityBar('Moderate',  probs.moderate  || 0, 'var(--ds-moderate)')}
        ${renderProbabilityBar('Extensive', probs.extensive || 0, 'var(--ds-extensive)')}
        ${renderProbabilityBar('Collapse',  probs.collapse  || 0, 'var(--ds-collapse)')}
      </div>
      <div class="lineage-box">
        <strong>Data Quality Lineage:</strong><br>
        • GEM Taxonomy: <code>${stype}</code> (src: <code>${stypeSrc}</code>)<br>
        • Height Source: <code>${heightSrc}</code>
      </div>
    </div>`;
}

function renderProbabilityBar(label, value, color) {
  const pct = (value * 100).toFixed(1);
  return `<div class="prob-row">
    <div class="prob-meta"><span>${label}</span><span>${pct}%</span></div>
    <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
  </div>`;
}

function closeDrawer() {
  document.getElementById('drawerBody').innerHTML = `
    <div class="empty-state">
      <p>Click any 3D building polygon in the scene to inspect structural parameters, PGA demand, and fragility probability distributions.</p>
    </div>`;
}

function generateFallbackGeoJSON() {
  const features = [];
  const minLat = 36.190, minLon = 36.140, grid = 12;
  const latStep = 0.003, lonStep = 0.003;
  let bCounter = 1;
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      if ((i + j) % 5 === 0) continue;
      const bMinLat = minLat + i * latStep;
      const bMaxLat = bMinLat + latStep * 0.7;
      const bMinLon = minLon + j * lonStep;
      const bMaxLon = bMinLon + lonStep * 0.7;
      const coords = [[bMinLon,bMinLat],[bMaxLon,bMinLat],[bMaxLon,bMaxLat],[bMinLon,bMaxLat],[bMinLon,bMinLat]];
      const h = 12.0 + (i * 1.5) % 18;
      const state = (i + j) % 8 === 0 ? 'collapse' : (i % 2 === 0 ? 'moderate' : 'extensive');
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          building_id: `bldg_antakya_${String(bCounter++).padStart(6,'0')}`,
          height_m: h, height_source: 'osm_levels',
          structural_type: 'CR/LFINF+CDM/H:4-7',
          structural_type_source: 'assumed_default_for_region',
          pga_g: 0.462,
          damage_state_probs: { none:0.01, slight:0.16, moderate:0.35, extensive:0.25, collapse:0.23 },
          predicted_damage_state: state, ground_truth_damage_state: state
        }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

window.addEventListener('load', () => {
  initCesiumViewer();
  loadDigitalTwinData();
});
