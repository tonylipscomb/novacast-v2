import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
path = sys.argv[1] if len(sys.argv) > 1 else r'C:\nc\ui_dump.xml'
data = open(path, encoding='utf-8').read()
found = False
for m in re.finditer(r'<node[^>]*>', data):
    g = m.group()
    if 'focused="true"' in g:
        found = True
        text = re.search(r'text="([^"]*)"', g)
        desc = re.search(r'content-desc="([^"]*)"', g)
        bounds = re.search(r'bounds="([^"]*)"', g)
        cls = re.search(r'class="([^"]*)"', g)
        print('FOCUSED node -> text=', text.group(1) if text else None, 'desc=', desc.group(1) if desc else None, 'class=', cls.group(1) if cls else None, 'bounds=', bounds.group(1) if bounds else None)
if not found:
    print('NO FOCUSED NODE FOUND')
