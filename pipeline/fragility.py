"""
Fragility & Damage State Probability Module
Calculates cumulative exceedance probabilities and discrete damage state distributions
(none, slight, moderate, extensive, collapse) from Peak Ground Acceleration (PGA)
using lognormal cumulative distribution fragility functions.
"""

import math
from scipy.stats import norm
from typing import Dict, Any, List


def lognormal_cdf(x: float, median: float, beta: float) -> float:
    """
    Computes lognormal cumulative distribution value Phi( (ln(x/median)) / beta ).
    """
    if x <= 0.0 or median <= 0.0 or beta <= 0.0:
        return 0.0
    u = math.log(x / median) / beta
    # Standard normal cumulative distribution function
    return float(norm.cdf(u))


def compute_building_damage_probs(pga_g: float, structural_type: str, fragility_cfg: Dict[str, Any]) -> Dict[str, float]:
    """
    Evaluates lognormal fragility exceedance probabilities for slight, moderate, extensive, and collapse
    damage states, then derives discrete damage state probabilities.
    """
    # Lookup structural parameters or fall back to default mid-rise RC
    type_params = fragility_cfg.get(structural_type)
    if not type_params:
        type_params = fragility_cfg.get("CR/LFINF+CDM/H:4-7", {
            "medians_g": {"slight": 0.15, "moderate": 0.28, "extensive": 0.48, "collapse": 0.75},
            "betas": {"slight": 0.50, "moderate": 0.55, "extensive": 0.60, "collapse": 0.65}
        })
        
    medians = type_params["medians_g"]
    betas = type_params["betas"]
    
    # Cumulative exceedance probabilities P(D >= d_i | PGA)
    p_slight_ex = lognormal_cdf(pga_g, medians["slight"], betas["slight"])
    p_moderate_ex = lognormal_cdf(pga_g, medians["moderate"], betas["moderate"])
    p_extensive_ex = lognormal_cdf(pga_g, medians["extensive"], betas["extensive"])
    p_collapse_ex = lognormal_cdf(pga_g, medians["collapse"], betas["collapse"])
    
    # Ensure physical monotonicity P(Slight) >= P(Moderate) >= P(Extensive) >= P(Collapse)
    p_slight_ex = max(p_slight_ex, p_moderate_ex)
    p_moderate_ex = max(p_moderate_ex, p_extensive_ex)
    p_extensive_ex = max(p_extensive_ex, p_collapse_ex)
    
    # Discrete probabilities
    p_none = max(0.0, 1.0 - p_slight_ex)
    p_slight = max(0.0, p_slight_ex - p_moderate_ex)
    p_moderate = max(0.0, p_moderate_ex - p_extensive_ex)
    p_extensive = max(0.0, p_extensive_ex - p_collapse_ex)
    p_collapse = max(0.0, p_collapse_ex)
    
    # Normalize probabilities to sum exactly to 1.0
    total = p_none + p_slight + p_moderate + p_extensive + p_collapse
    if total > 0.0:
        p_none /= total
        p_slight /= total
        p_moderate /= total
        p_extensive /= total
        p_collapse /= total
    else:
        p_none = 1.0
        
    return {
        "none": round(p_none, 4),
        "slight": round(p_slight, 4),
        "moderate": round(p_moderate, 4),
        "extensive": round(p_extensive, 4),
        "collapse": round(p_collapse, 4)
    }


def predict_damage_states(buildings: List[Dict[str, Any]], config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Computes damage state probability distributions and assigns predicted_damage_state for all buildings.
    """
    fragility_cfg = config.get("fragility_curves", {})
    print(f"[Fragility] Evaluating lognormal fragility functions across {len(buildings)} buildings...")
    
    state_counts = {"none": 0, "slight": 0, "moderate": 0, "extensive": 0, "collapse": 0}
    
    for feature in buildings:
        props = feature["properties"]
        pga_g = props.get("pga_g", 0.40)
        stype = props.get("structural_type", "CR/LFINF+CDM/H:4-7")
        
        probs = compute_building_damage_probs(pga_g, stype, fragility_cfg)
        
        # Max probability state prediction
        predicted_state = max(probs, key=probs.get)
        
        props["damage_state_probs"] = probs
        props["predicted_damage_state"] = predicted_state
        
        state_counts[predicted_state] += 1
        
    print(f"[Fragility] Damage distribution summary:")
    for state, count in state_counts.items():
        pct = (count / len(buildings)) * 100.0
        print(f"  - {state.upper():<10}: {count} buildings ({pct:.1f}%)")
        
    return buildings
