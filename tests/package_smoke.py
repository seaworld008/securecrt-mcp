"""Validate archive bytes and checksum round-trip; does not publish a release."""
import hashlib
import posixpath
import re
from pathlib import Path
import subprocess
import sys
import tempfile
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
    expected.update(p.relative_to(root).as_posix() for p in (root/'docs').rglob('*.json'))
    expected.update(p.relative_to(root).as_posix() for pattern in ('*.py','*.ps1') for p in (root/'clients').glob(pattern))
    expected.update(p.relative_to(root).as_posix() for p in (root/'support').glob('*.json'))
    expected.update(p.relative_to(root).as_posix() for p in (root/'bridge').glob('*.py'))
    expected.update(p.relative_to(root).as_posix() for p in (root/'bridge').glob('*.js'))
    if 'windows' in target.lower():
        sys.path.insert(0, str(root/'scripts'))
        from portable_scripts import windows_scripts
        generated = windows_scripts(root, binary)
        expected.update(generated)
        for name, content in generated.items():
            assert package.read(name) == content
    expected.update('tests/'+name for name in ('desktop_matrix.py','desktop_lifecycle_probe.py','connector_acceptance.py','securecrt_desktop_smoke.py','mcp_smoke.py','protocol_harness.py','performance_smoke.py','test_bridge.py'))
    assert set(package.namelist()) == expected, sorted(set(package.namelist()) ^ expected)
    assert len(package.namelist()) == len(expected), 'duplicate archive members'
    for member in expected:
        if member.endswith('.py'):
            compile(package.read(member), member, 'exec')
    for member in package.namelist():
        if not member.endswith('.md'):
            continue
        for link in re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)', package.read(member).decode('utf-8')):
            link = link.split('#', 1)[0]
            if link and '://' not in link and not link.startswith('mailto:'):
                target_member = posixpath.normpath(posixpath.join(posixpath.dirname(member), link))
                assert target_member in expected, f'{member}: missing archive link {link}'
    assert 'clients/persistent_client.py' in expected and 'docs/migration-0.3.md' in expected
    with tempfile.TemporaryDirectory() as extracted:
        package.extractall(extracted)
        subprocess.run([sys.executable, str(Path(extracted)/'tests/performance_smoke.py'), '--help'],
                       check=True, capture_output=True, timeout=15)
print('PASS: executable/archive byte identity, expected manifest and SHA-256 sidecar; no release published')
