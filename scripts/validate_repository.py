"""Offline consistency checks. Does not fetch links or need third-party packages."""
import ast
from pathlib import Path
import re
import tomllib

root = Path(__file__).resolve().parents[1]
version = tomllib.loads((root / 'Cargo.toml').read_text(encoding="utf-8"))['package']['version']
bridge = ast.parse((root / 'bridge/securecrt_bridge.py').read_text(encoding="utf-8"))
constants = {n.targets[0].id: ast.literal_eval(n.value) for n in bridge.body
             if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
             and n.targets[0].id in ('BRIDGE_VERSION', 'PROTOCOL_VERSION')}
assert constants['BRIDGE_VERSION'] == version
assert constants['PROTOCOL_VERSION'] == 2
assert (root / 'README.md').read_bytes() == (root / 'README.zh-CN.md').read_bytes()
for name in ('README.md', 'README.en.md', 'CHANGELOG.md'):
    assert version in (root / name).read_text(encoding="utf-8"), name
for file in list(root.glob('*.md')) + list((root / 'docs').rglob('*.md')):
    for target in re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)', file.read_text(encoding="utf-8")):
        target = target.split('#', 1)[0]
        if target and '://' not in target and not target.startswith('mailto:'):
            assert (file.parent / target).exists(), f'{file}: broken local link {target}'
print('PASS: version/protocol, bilingual mirror and local documentation links')
