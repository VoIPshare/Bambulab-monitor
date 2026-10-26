#!/usr/bin/env sh
# First run: creates the virtual environment and installs dependencies. Then starts the daemon.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -q -r requirements.txt
fi
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "Created config.json - edit it with your printers' IP, serial and access code, then run ./start.sh again."
  exit 1
fi
mkdir -p data
exec .venv/bin/python server.py "$@"
