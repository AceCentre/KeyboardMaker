#!/bin/bash

echo "Updating requirements.txt"
uv sync
uv pip compile pyproject.toml -o requirements.txt >/dev/null
echo "-e ." >>requirements.txt

if command -v npm >/dev/null 2>&1; then
  echo "Installing node dependencies"
  npm install
  echo "Building browser layout generator"
  npm run build:browser
else
  echo "npm not found: skipping browser generator build (Keyman flow still works)"
fi
echo "Successfully updated requirements.txt"
