import urllib.request, json, os

print("=== IIT Kharagpur Campus Data Extractor ===")

# Overpass API Bounding Box for IIT Kharagpur (Lat: 22.300 to 22.335, Lon: 87.295 to 87.325)
bbox = "22.300,87.295,22.335,87.325"
overpass_url = "https://overpass-api.de/api/interpreter"

# Query for buildings, roads, and campus landmarks
query = f"""[out:json][timeout:30];
(
  way["building"]({bbox});
  way["highway"]({bbox});
  way["waterway"]({bbox});
  way["natural"="water"]({bbox});
);
out body;
>;
out skel qt;"""

try:
    print("Querying OpenStreetMap Overpass API for IIT Kharagpur...")
    headers = {'User-Agent': 'GeoAI-DigitalTwin-IITKGP/1.0 (Research Project)'}
    req = urllib.request.Request(overpass_url, data=query.encode('utf-8'), headers=headers)
    with urllib.request.urlopen(req, timeout=35) as resp:
        osm_data = json.loads(resp.read().decode('utf-8'))
        elements = osm_data.get('elements', [])
        
        # Parse nodes and ways
        nodes = {e['id']: (e['lon'], e['lat']) for e in elements if e['type'] == 'node'}
        building_ways = [e for e in elements if e['type'] == 'way' and 'building' in e.get('tags', {})]
        road_ways = [e for e in elements if e['type'] == 'way' and 'highway' in e.get('tags', {})]
        water_ways = [e for e in elements if e['type'] == 'way' and ('waterway' in e.get('tags', {}) or e.get('tags', {}).get('natural') == 'water')]
        
        print(f"-> Extracted {len(building_ways)} Real Building Footprints")
        print(f"-> Extracted {len(road_ways)} Campus Roads & Scholar's Avenue segments")
        print(f"-> Extracted {len(water_ways)} Waterbodies (Lotus Pond, Gymkhana Lake)")
        
        # Convert to GeoJSON format for the Digital Twin engine
        features = []
        for i, way in enumerate(building_ways):
            w_nodes = way.get('nodes', [])
            coords = [nodes[nid] for nid in w_nodes if nid in nodes]
            if len(coords) >= 3:
                tags = way.get('tags', {})
                b_name = tags.get('name', tags.get('building:name', f"IITKGP_Bldg_{i+1}"))
                levels = float(tags.get('building:levels', tags.get('levels', '3')))
                h_m = levels * 3.8
                
                # Classify structural type based on IIT Kharagpur campus architectural age
                if "Hijli" in b_name or "Nehru" in b_name or "Museum" in b_name:
                    stype = "URM/LWAL/H:1-2" # Historical Masonry
                elif levels >= 6:
                    stype = "CR/LFINF+CDM/H:8+" # Modern Highrise (Nalanda / VGSOM / CSE)
                elif levels >= 4:
                    stype = "CR/LFINF+CDM/H:4-7" # Mid-rise Academic
                else:
                    stype = "CR/LFINF+CDM/H:1-3" # Low-rise Hall of Residence
                
                features.append({
                    "type": "Feature",
                    "properties": {
                        "building_id": f"iitkgp_{i+1}",
                        "name": b_name,
                        "height_m": h_m,
                        "levels": levels,
                        "structural_type": stype,
                        "pga_g": 0.16, # IS 1893:2016 Zone III Factor
                        "predicted_damage_state": "slight"
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords]
                    }
                })
        
        geojson = {
            "type": "FeatureCollection",
            "name": "IIT_Kharagpur_Campus_Digital_Twin",
            "source": "OpenStreetMap Real IIT KGP Data",
            "features": features
        }
        
        os.makedirs('viewer/data', exist_ok=True)
        with open('viewer/data/iitkgp-campus.json', 'w', encoding='utf-8') as f:
            json.dump(geojson, f, indent=2)
            
        print("-> Saved viewer/data/iitkgp-campus.json successfully!")
        
except Exception as e:
    print("Error fetching IIT Kharagpur OSM data:", e)
