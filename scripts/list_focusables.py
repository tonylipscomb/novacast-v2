import re
import sys

path = sys.argv[1]
content = open(path, encoding='utf-8', errors='ignore').read()

print('=== FOCUSED ===')
for node in re.findall(r'<node[^>]*/?>', content):
    if 'focused="true"' not in node:
        continue
    text = re.search(r'text="([^"]*)"', node)
    desc = re.search(r'content-desc="([^"]*)"', node)
    cls = re.search(r'class="([^"]*)"', node)
    bounds = re.search(r'bounds="([^"]*)"', node)
    print(
        cls.group(1) if cls else '?',
        '| text:', text.group(1) if text else '',
        '| desc:', desc.group(1) if desc else '',
        '|', bounds.group(1) if bounds else '',
    )

print('\n=== FOCUSABLE ===')
for node in re.findall(r'<node[^>]*/?>', content):
    if 'focusable="true"' not in node:
        continue
    text = re.search(r'text="([^"]*)"', node)
    desc = re.search(r'content-desc="([^"]*)"', node)
    cls = re.search(r'class="([^"]*)"', node)
    bounds = re.search(r'bounds="([^"]*)"', node)
    focused = 'focused="true"' in node
    label = desc.group(1) if desc and desc.group(1) else text.group(1) if text and text.group(1) else cls.group(1) if cls else '?'
    print(('>> ' if focused else '   ') + label, bounds.group(1) if bounds else '')
