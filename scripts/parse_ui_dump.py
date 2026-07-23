import re
import sys

path = sys.argv[1]
content = open(path, encoding='utf-8', errors='ignore').read()
for node in re.findall(r'<node[^>]*focused="true"[^>]*/?>', content):
    text = re.search(r'text="([^"]*)"', node)
    desc = re.search(r'content-desc="([^"]*)"', node)
    print('focused:', text.group(1) if text else '', '|', desc.group(1) if desc else '')
for needle in ['Provider connection failed', 'Content Hub', 'Live TV', 'Movies', 'Categories', 'Channels', 'Back to Live TV', 'Play']:
    print(f'{needle}:', needle in content)
