"""Purpose: verify an installable ZIP contains the exact tested extension source.
Setup: run after npm run package, or supply a downloaded release ZIP as the first argument.
Writes: a small integrity report under test-results; never changes source or the archive.
Constraints: exact file set and bytes, root-level manifest, no extra development/personal files.
"""
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
version = json.loads((EXT / "manifest.json").read_text())["version"]
archive_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / f"Bullseye-Palette-Picker-v{version}.zip"
expected = {p.relative_to(EXT).as_posix(): p for p in EXT.rglob("*") if p.is_file()}
expected.update({name: ROOT / name for name in ["README.md", "ATTRIBUTION.md", "PRIVACY.md", "LICENSE"]})
with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None, "ZIP CRC failure"
    assert len(archive.namelist()) == len(set(archive.namelist())), "Duplicate archive entries"
    assert set(archive.namelist()) == set(expected), "Archive file set differs from tested source"
    for name, source in expected.items():
        assert archive.read(name) == source.read_bytes(), f"Archive differs: {name}"
    assert json.loads(archive.read("manifest.json"))["version"] == version
hashes = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in sorted(expected.items())}
report = {
    "version": version,
    "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "sourceTree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip(),
    "archive": archive_path.name,
    "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
    "files": hashes,
}
(ROOT / "test-results").mkdir(exist_ok=True)
(ROOT / "test-results/package-integrity.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: v{version} ZIP has exactly {len(expected)} files, all byte-for-byte equal to tested source.")
print(f"SHA-256: {report['archiveSha256']}")
