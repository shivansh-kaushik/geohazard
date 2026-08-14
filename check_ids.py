import re

with open('viewer/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

get_ids = re.findall(r"document\.getElementById\(['\"](.*?)['\"]", html)
html_ids = set(re.findall(r"id=['\"](.*?)['\"]", html))

missing = [i for i in get_ids if i not in html_ids]
print("All getElementById count:", len(get_ids))
print("Missing IDs:", set(missing))
