"""Package a previously built binary and create a SHA-256 sidecar. No downloads."""
import hashlib
from pathlib import Path
import sys
import tomllib
import zipfile

root = Path(__file__).resolve().parents[1]
version = tomllib.loads((root / 'Cargo.toml').read_text(encoding="utf-8"))['package']['version']
binary = Path(sys.argv[1]).resolve()
target = sys.argv[2]
assert binary.is_file(), binary
assert target and all(c.isalnum() or c in '-_' for c in target), 'invalid target'
destination = root / 'dist'; destination.mkdir(exist_ok=True)
archive = destination / f'securecrt-mcp-{version}-{target}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.write(binary, binary.name)
    files=[root/'LICENSE',root/'README.md',root/'README.en.md',root/'README.zh-CN.md',root/'CHANGELOG.md',root/'CONTRIBUTING.md',root/'SECURITY.md',root/'ROADMAP.md']
    files+=list((root/'docs').rglob('*.md'))+list((root/'docs'/'benchmarks').glob('*.json'))
    files+=list((root/'clients').glob('*.py'))+list((root/'clients').glob('*.ps1'))
    for path in files:
        z.write(path,path.relative_to(root).as_posix())
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix + '.sha256').write_text(checksum + '  ' + archive.name + '\n', encoding='ascii')
print(archive.name, checksum)
