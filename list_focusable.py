import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
path = sys.argv[1] if len(sys.argv) > 1 else r'C:\nc\ui_dump.xml'
data = open(path, encoding='utf-8').read()
for m in re.finditer(r'<node[^>]*>', data):
    g = m.group()
    if 'focusable="true"' in g:
        text = re.search(r'text="([^"]*)"', g)
        desc = re.search(r'content-desc="([^"]*)"', g)
        bounds = re.search(r'bounds="([^"]*)"', g)
        visible = re.search(r'visible-to-user="([^"]*)"', g)
        print('text=', text.group(1) if text else '', '| desc=', desc.group(1) if desc else '', '| bounds=', bounds.group(1) if bounds else '', '| visible=', visible.group(1) if visible else 'n/a')
