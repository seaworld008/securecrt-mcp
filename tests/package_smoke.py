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
    expected={binary.name,'LICENSE','README.md','README.en.md','README.zh-CN.md','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','ROADMAP.md'}
    expected.update(p.relative_to(root).as_posix() for p in (root/'docs').rglob('*.md'))
    expected.update(p.relative_to(root).as_posix() for p in (root/'docs'/'benchmarks').glob('*.json'))
    expected.update(p.relative_to(root).as_posix() for pattern in ('*.py','*.ps1') for p in (root/'clients').glob(pattern))
    assert set(package.namelist()) == expected, sorted(set(package.namelist()) ^ expected)
    assert len(package.namelist()) == len(expected), 'duplicate archive members'
    assert 'clients/persistent_client.py' in expected and 'docs/migration-0.3.md' in expected
print('PASS: executable/archive byte identity, expected manifest and SHA-256 sidecar; no release published')
