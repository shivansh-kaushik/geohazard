import re, subprocess, json

with open('viewer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Extract script blocks
scripts = re.findall(r'<script[\s\S]*?>(.*?)</script>', html, re.DOTALL)
full_js = "\n".join(scripts)

# Save extracted JS to a temp file
with open('temp_check.js', 'w', encoding='utf-8') as f:
    f.write(full_js)

print(f"Extracted JS size: {len(full_js)} characters.")

# Run node --check to get exact line number of syntax errors
try:
    res = subprocess.run(['node', '--check', 'temp_check.js'], capture_output=True, text=True)
    if res.returncode == 0:
        print("Node syntax check: OK! No syntax errors.")
    else:
        print("Node syntax error:")
        print(res.stderr)
except Exception as e:
    print("Could not run node check:", e)
