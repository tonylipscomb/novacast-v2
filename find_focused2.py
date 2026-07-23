import re
data = open(r'C:\nc\ui_backfocus1.xml', encoding='utf-8').read()
for m in re.finditer(r'<node[^>]*focused="true"[^>]*>', data):
    g = m.group()
    text = re.search(r'text="([^"]*)"', g)
    desc = re.search(r'content-desc="([^"]*)"', g)
    bounds = re.search(r'bounds="([^"]*)"', g)
    print('text=', text.group(1) if text else None, 'desc=', desc.group(1) if desc else None, 'bounds=', bounds.group(1) if bounds else None)
