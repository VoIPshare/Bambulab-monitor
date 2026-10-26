# Windows: run the daemon automatically at startup

1. Install Python 3.10+ and run `start.bat` once (it creates `.venv` and installs dependencies). Close it with Ctrl+C.
2. Open **Task Scheduler** → **Create Task** (not "Basic Task").
3. **General**: name it `Bambu LAN Monitor`, select **Run whether user is logged on or not**.
4. **Triggers**: **New…** → **At startup**. (Optionally add a 30 s delay so Wi-Fi is up.)
5. **Actions**: **New…** → **Start a program**
   - Program/script: `C:\Path\To\bambu-lan-monitor\.venv\Scripts\pythonw.exe`
   - Add arguments: `server.py`
   - Start in: `C:\Path\To\bambu-lan-monitor`
6. **Conditions**: clear "Start the task only if the computer is on AC power" on a laptop.
7. **Settings**: tick "If the task fails, restart every 1 minute" and clear "Stop the task if it runs longer than…".
8. Save, right-click the task → **Run**, then open http://localhost:8787.

`pythonw.exe` runs without a console window. To stop it, end the task in Task Scheduler.
If Windows Firewall asks about Python, **Private networks** is enough (the daemon must reach your printers on port 8883).
