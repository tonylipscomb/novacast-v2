import re
import sys
from pathlib import Path

xml = Path(sys.argv[1]).read_text(encoding="utf-8")
nodes = re.findall(r'<node[^>]*focused="true"[^>]*>', xml)
print(f"focused count: {len(nodes)}")
for n in nodes:
    text = re.search(r'text="([^"]*)"', n)
    desc = re.search(r'content-desc="([^"]*)"', n)
    cls = re.search(r'class="([^"]*)"', n)
    print(f"  text={text.group(1) if text else ''!r} desc={desc.group(1) if desc else ''!r} class={cls.group(1) if cls else ''}")
