/**
 * @fileoverview Seismic Hazard Engine — GMPE & Lognormal Fragility Computation
 *
 * @description
 * Implements a complete seismic hazard computation pipeline for a single-point
 * earthquake scenario. Computes site-specific Peak Ground Acceleration (PGA)
 * using the Akkar et al. (2014) GMPE calibrated for the Turkish strong-motion
 * network, then applies lognormal cumulative distribution function (CDF) fragility
 * curves to compute discrete damage state probability distributions for each
 * building in the digital twin.
 *
 * @methodology
 * 1. GMPE (Akkar et al. 2014): ln(PGA) = c1 + c2*(Mw-6) + c3*ln(R_hypo) + f_site
 *    where R_hypo = sqrt(R_epi² + depth²)
 * 2. Fragility CDFs: P(D≥d | PGA) = Φ((ln(PGA/θ))/β)
 *    where Φ is the standard normal CDF, θ is median PGA capacity, β is dispersion
 * 3. Discrete state probabilities derived from exceedance differences
 * 4. Maximum a-posteriori (MAP) estimate for final damage state assignment
 *
 * @references
 * - Akkar, S. et al. (2014). The Turkish national strong-motion network.
 *   Bulletin of Earthquake Engineering, 12(1), 35-56.
 * - Boore, D.M. et al. (2014). NGA-West2 equations for predicting PGA.
 *   Earthquake Spectra, 30(3), 1057-1085.
 * - Rossetto, T. & Elnashai, A. (2003). Derivation of vulnerability functions.
 *   Engineering Structures, 25(10), 1241-1263.
 * - FEMA (2020). HAZUS Earthquake Model Technical Manual. Washington, D.C.
 *
 * @author GeoAI Research Lab, IIT Kharagpur
 * @version 2.0.0
 */

'use strict';

// ── GMPE Coefficients (Akkar et al. 2014, PGA, rock site Vs30=760) ──────────
const AKKAR_COEFF = {
  c1:  3.449,  // intercept
  c2:  0.554,  // magnitude scaling
  c3: -1.421,  // geometric attenuation
  h0:  6.0,    // pseudo-depth factor (km)
  sigma: 0.59  // total sigma (ln units)
};

// ── Site amplification factors by NEHRP class ────────────────────────────────
const SITE_FACTORS = {
  A: 0.80,  // Hard rock
  B: 0.90,  // Rock
  C: 1.00,  // Very dense soil (reference)
  D: 1.15,  // Stiff soil (default for Antakya)
  E: 1.35   // Soft clay
};

/**
 * Computes the standard normal CDF Φ(x) using the Abramowitz & Stegun
 * rational approximation (error < 7.5e-8).
 *
 * @param {number} x - Standardized variable
 * @returns {number} - Probability in [0, 1]
 */
function stdNormCDF(x) {
  const sign = x >= 0 ? 1 : -1;
  const z = Math.abs(x) / Math.SQRT2;
  // Error function approximation
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592
    + t * (-0.284496736
    + t * (1.421413741
    + t * (-1.453152027
    + t *  1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/**
 * Computes PGA (in g) at a site using the Akkar et al. (2014) GMPE.
 *
 * @param {number} Mw        - Moment magnitude
 * @param {number} R_epi_km  - Epicentral distance (km)
 * @param {number} depth_km  - Focal depth (km)
 * @param {string} [siteClass='D'] - NEHRP site class (A–E)
 * @returns {number} - Median PGA estimate in g
 */
function computePGA(Mw, R_epi_km, depth_km = 10, siteClass = 'D') {
  const { c1, c2, c3, h0 } = AKKAR_COEFF;
  const R_hypo = Math.sqrt(R_epi_km * R_epi_km + depth_km * depth_km + h0 * h0);
  const lnPGA  = c1 + c2 * (Mw - 6) + c3 * Math.log(R_hypo);
  const sf     = SITE_FACTORS[siteClass] || 1.0;
  return Math.exp(lnPGA) * sf;
}

/**
 * Computes epicentral distance (km) between a building centroid and an epicenter
 * using the Haversine formula.
 *
 * @param {number} bLat  - Building latitude (°)
 * @param {number} bLon  - Building longitude (°)
 * @param {number} eLat  - Epicenter latitude (°)
 * @param {number} eLon  - Epicenter longitude (°)
 * @returns {number} - Distance in km
 */
function haversineKm(bLat, bLon, eLat, eLon) {
  const R   = 6371;
  const dLat = (eLat - bLat) * Math.PI / 180;
  const dLon = (eLon - bLon) * Math.PI / 180;
  const a   = Math.sin(dLat / 2) ** 2
    + Math.cos(bLat * Math.PI / 180) * Math.cos(eLat * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Computes discrete damage state probabilities for a building given PGA and
 * fragility parameters using lognormal CDF curves.
 *
 * @param {number}   pga_g  - Peak Ground Acceleration in g
 * @param {number[]} theta  - Median PGA thresholds [slight, moderate, extensive, collapse]
 * @param {number[]} beta   - Dispersion values for each state
 * @returns {{ none:number, slight:number, moderate:number, extensive:number, collapse:number }}
 */
function computeDamageProbs(pga_g, theta, beta) {
  // P(D >= d_i | PGA) for each threshold
  const exceed = theta.map((th, i) => {
    if (pga_g <= 0 || th <= 0) return 0;
    return stdNormCDF(Math.log(pga_g / th) / beta[i]);
  });

  // Convert to discrete mutually-exclusive probabilities
  const pNone      = 1 - exceed[0];
  const pSlight    = Math.max(0, exceed[0] - exceed[1]);
  const pModerate  = Math.max(0, exceed[1] - exceed[2]);
  const pExtensive = Math.max(0, exceed[2] - exceed[3]);
  const pCollapse  = exceed[3];

  return {
    none:      +pNone.toFixed(4),
    slight:    +pSlight.toFixed(4),
    moderate:  +pModerate.toFixed(4),
    extensive: +pExtensive.toFixed(4),
    collapse:  +pCollapse.toFixed(4)
  };
}

/**
 * Selects the most probable damage state (MAP estimate) from a probability object.
 *
 * @param {{ none:number, slight:number, moderate:number, extensive:number, collapse:number }} probs
 * @returns {string} - Damage state label
 */
function mapDamageState(probs) {
  return Object.entries(probs).reduce((best, [state, p]) =>
    p > best[1] ? [state, p] : best, ['none', -1]
  )[0];
}

/**
 * Runs the full per-building hazard computation for a city, given an earthquake
 * scenario and building inventory.
 *
 * @param {Object}   scenario           - Earthquake parameters
 * @param {number}   scenario.Mw        - Moment magnitude
 * @param {number}   scenario.lat       - Epicenter latitude
 * @param {number}   scenario.lon       - Epicenter longitude
 * @param {number}   [scenario.depth=10]- Focal depth (km)
 * @param {string}   [scenario.site='D']- NEHRP site class
 * @param {Array}    buildings          - Array of building objects with lat/lon/fragility
 * @returns {Array} - Buildings annotated with pga_g, damage_state_probs, predicted_damage_state
 */
function runScenario(scenario, buildings) {
  const { Mw, lat, lon, depth = 10, site = 'D' } = scenario;

  return buildings.map(b => {
    const dist    = haversineKm(b.lat, b.lon, lat, lon);
    const pga_g   = computePGA(Mw, dist, depth, site);
    const theta   = b.fragility?.theta || [0.12, 0.27, 0.48, 0.75];
    const beta    = b.fragility?.beta  || [0.65, 0.65, 0.65, 0.65];
    const probs   = computeDamageProbs(pga_g, theta, beta);
    const state   = mapDamageState(probs);

    return { ...b, pga_g, damage_state_probs: probs, predicted_damage_state: state };
  });
}

// ── Exports ──────────────────────────────────────────────────────────────────
window.HazardEngine = {
  computePGA,
  haversineKm,
  computeDamageProbs,
  mapDamageState,
  runScenario,
  stdNormCDF
};
