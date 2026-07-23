import io
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\nc\dump4.xml'
try:
    with open(path, encoding='utf-16') as f:
        content = f.read()
except UnicodeError:
    with open(path, encoding='utf-8', errors='ignore') as f:
        content = f.read()
nodes = re.findall(r'<node[^>]*focused="true"[^>]*/?>', content)
for n in nodes:
    m = re.search(r'content-desc="([^"]*)"', n)
    print(m.group(1) if m else n[:200])
