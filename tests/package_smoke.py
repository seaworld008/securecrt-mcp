"""Validate archive bytes and checksum round-trip; does not publish a release."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tomllib
import zipfile

root = Path(__file__).resolve().parents[1]
binary = Path(sys.argv[1]).resolve()
target = sys.argv[2]
version = tomllib.loads((root / 'Cargo.toml').read_text(encoding='utf-8'))['package']['version']
subprocess.run([sys.executable, str(root / 'scripts/package_release.py'), str(binary), target], check=True)
archive = root / 'dist' / ('securecrt-mcp-' + version + '-' + target + '.zip')
checksum, filename = archive.with_suffix('.zip.sha256').read_text(encoding='ascii').strip().split('  ', 1)
assert filename == archive.name
assert checksum == hashlib.sha256(archive.read_bytes()).hexdigest()
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert package.read(binary.name) == binary.read_bytes()
    assert set(package.namelist()) == {binary.name, 'LICENSE', 'README.md', 'README.en.md', 'docs/migration-0.2.md'}
print('PASS: executable/archive byte identity, expected manifest and SHA-256 sidecar; no release published')
