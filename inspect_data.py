import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('viewer/data.js', 'r', encoding='utf-8') as f:
    content = f.read()

json_str = content.replace('window.DIGITAL_TWIN_DATA = ', '').rstrip(';').strip()
data = json.loads(json_str)
feats = data['features']
print(f'Total buildings: {len(feats)}')

lons, lats, heights, pgas, damages = [], [], [], [], []
for f in feats:
    try:
        ring = f['geometry']['coordinates'][0]
        p = f['properties']
        lons.append(ring[0][0])
        lats.append(ring[0][1])
        heights.append(float(p.get('height_m') or 12))
        pgas.append(float(p.get('pga_g') or 0.4))
        damages.append(p.get('predicted_damage_state','none'))
    except:
        pass

print(f'Lon range: {min(lons):.5f} to {max(lons):.5f}')
print(f'Lat range: {min(lats):.5f} to {max(lats):.5f}')
print(f'Height range: {min(heights):.1f}m to {max(heights):.1f}m')
print(f'PGA range: {min(pgas):.3f}g to {max(pgas):.3f}g')

from collections import Counter
dc = Counter(damages)
print('Damage states:', dict(dc))

# Sample building with full geometry
f0 = feats[0]
p0 = f0['properties']
print()
print('Sample building 0:')
print('  ID:', p0.get('building_id'))
print('  height_m:', p0.get('height_m'))
print('  pga_g:', p0.get('pga_g'))
print('  damage:', p0.get('predicted_damage_state'))
print('  coords:', f0['geometry']['coordinates'][0][:3])
