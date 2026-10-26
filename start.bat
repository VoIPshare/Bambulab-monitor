@echo off
REM First run: creates the virtual environment and installs dependencies. Then starts the daemon.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\python -m pip install -q -r requirements.txt
)
if not exist config.json (
  copy config.example.json config.json >nul
  echo Created config.json - edit it with your printers IP, serial and access code, then run start.bat again.
  notepad config.json
  exit /b 1
)
if not exist data mkdir data
.venv\Scripts\python server.py %*
