#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/chatgpt-markdown-exporter"
DIST_DIR="$ROOT_DIR/dist"

python3 - "$EXTENSION_DIR" "$DIST_DIR" <<'PY'
import json
import sys
import zipfile
from pathlib import Path

extension_dir = Path(sys.argv[1]).resolve()
dist_dir = Path(sys.argv[2]).resolve()
manifest_path = extension_dir / "manifest.json"

with manifest_path.open("r", encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

name = manifest["name"].lower().replace(" ", "-")
version = manifest["version"]
archive_path = dist_dir / f"{name}-v{version}.zip"

dist_dir.mkdir(parents=True, exist_ok=True)
if archive_path.exists():
    archive_path.unlink()

with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(extension_dir.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(extension_dir))

print(archive_path)
PY
