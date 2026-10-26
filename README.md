# Bambu LAN Monitor Pro v2.1 (Python)

A small local daemon that watches two or more Bambu Lab printers over your LAN and shows them in your browser. No Bambu cloud, no accounts, no external services, nothing leaves your network.

```
 printers (MQTT/TLS :8883)  ──►  server.py (daemon)  ──►  http://localhost:8787
```

- Any number of printers (X1, P1, A1 series), each with its own connection and automatic reconnect
- Progress, ETA, layers, nozzle/bed/chamber temperatures, AMS (multi-unit), errors, Wi-Fi
- Live camera view and the plate preview image of the current job
- Read-only: the only thing ever sent to a printer is the standard "pushall" status request (the camera and plate preview only read from the printer)
- Optional SQLite history and job log (Python's built-in `sqlite3`)
- Runs as a service on Linux (systemd), macOS (launchd) and Windows (Task Scheduler)

## 1. Prepare each printer

On the printer's screen, go to **Settings → Network (WLAN)** and note:

- **IP address** (give it a fixed/reserved IP in your router so it doesn't change)
- **Access Code** (the 8-character LAN code)
- **Serial number**: **Settings → Device** (or on the sticker)

Turn on **LAN Only Mode**. Recent firmware also has a **Developer Mode** toggle under LAN Only; if the dashboard says the connection was refused or the printer never reports, enable it.

## 2. Configure

Copy `config.example.json` to `config.json` and fill in one block per printer:

```json
{
  "webPort": 8787,
  "bindAddress": "127.0.0.1",
  "printers": [
    { "name": "X1 Carbon",    "model": "X1C", "ip": "192.168.1.123", "serial": "00M00A000000000", "accessCode": "12345678" },
    { "name": "P1S Workshop", "model": "P1S", "ip": "192.168.1.124", "serial": "01P00A000000000", "accessCode": "87654321" }
  ]
}
```

Check it without starting anything:

```bash
python server.py --check
```

| Setting | Default | Meaning |
|---|---|---|
| `webPort` | 8787 | Dashboard port |
| `bindAddress` | 127.0.0.1 | `127.0.0.1` = this computer only. `0.0.0.0` = phones/tablets on your LAN can open it too (restrict with your firewall) |
| `staleAfterSeconds` | 60 | A connected printer with no report for this long is shown as "Quiet" |
| `pushallMinIntervalSeconds` | 120 | When a printer is quiet, re-request its full state at most this often |
| `exposeRawReports` | true | Show the raw MQTT JSON under each printer |
| `enableHistory` | false | Record samples and finished jobs to `data/history.db` |
| `historyIntervalSeconds` | 30 | Sample interval |
| `historyRetentionDays` | 30 | Older history is deleted |
| `enablePlatePreview` | true | Show the plate image from the current job's .3mf |

Per printer you can also set:

| Setting | Default | Meaning |
|---|---|---|
| `port` | 8883 | MQTT port |
| `model` | | e.g. `X1C`, `P1S`, `A1 mini`. Used to pick the camera type |
| `camera` | `auto` | `auto`, `tcp` (P1/A1), `rtsp` (X1/H2/P2S, needs ffmpeg) or `off` |

## 3. Run it

**Easiest:** `./start.sh` (macOS/Linux) or double-click `start.bat` (Windows). The first run creates a virtual environment, installs the three dependencies, and creates `config.json` for you to edit. Run it again to start.

**Manually:**

```bash
python3 -m venv .venv
. .venv/bin/activate            # Windows: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python server.py
```

Open **http://localhost:8787**. Stop with Ctrl+C.

Open `static/index.html` directly from disk to see a preview with sample data (no daemon needed).

## Camera and plate preview

The camera only streams while the dashboard is open, and stops 30 seconds after the last viewer leaves. Each card has an **Off / S / M / L** picker for the camera size (S and M scale with the card width). Your choice is remembered in this browser. **Off** also stops the stream.

- **P1 / A1**: works out of the box (JPEG stream on port 6000, about 1 frame per second).
- **X1 / H2 / P2S**: enable **LAN Mode Liveview** on the printer (Settings → Network) and install [ffmpeg](https://ffmpeg.org/download.html) (`brew install ffmpeg`, `sudo apt install ffmpeg`, or `winget install ffmpeg`). The stream comes from RTSPS on port 322 and is shown at 2 frames per second.

With `"camera": "auto"`, the camera type comes from `model`. Without a model, it uses RTSP when port 322 is open, otherwise port 6000.

The plate preview is read from the job's `.3mf` on the printer's storage (FTPS, port 990). It's downloaded once per job and replaces the printer icon next to the job name. Jobs sent as plain `.gcode` have no preview.

## 4. Run as a background service (daemon)

### Linux (systemd)

```bash
sudo useradd --system --no-create-home bambu
sudo cp -r bambu-lan-monitor /opt/
cd /opt/bambu-lan-monitor
sudo python3 -m venv .venv && sudo .venv/bin/pip install -r requirements.txt
sudo mkdir -p data && sudo chown -R bambu:bambu /opt/bambu-lan-monitor
sudo chmod 600 config.json
sudo cp services/bambu-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bambu-monitor
journalctl -u bambu-monitor -f     # live log
```

The `data` folder must exist before starting: the unit is sandboxed and can only write there.

### macOS (launchd)

Replace every `USERNAME` in `services/com.bambu.monitor.plist` with your user name (and adjust the path if you put the folder elsewhere), then:

```bash
mkdir -p ~/bambu-lan-monitor/data
cp services/com.bambu.monitor.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bambu.monitor.plist
# remove: launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.bambu.monitor.plist
```

Logs go to `data/server.log`. macOS may ask once to allow Python to find devices on the local network; allow it.

### Windows (Task Scheduler)

See `services/windows-task-scheduler.md`.

## API

All JSON, local only:

- `GET /api/health`: daemon version, uptime, per-printer connection and last error
- `GET /api/status`: full state of every printer
- `GET /api/summary`: fleet counters
- `GET /api/history/<printer-id>?hours=24&limit=1000`: samples (history enabled)
- `GET /api/jobs?limit=50`: finished/failed/cancelled jobs (history enabled)
- `GET /api/camera/<printer-id>.jpg`: latest camera frame (503 with an `error` while connecting)
- `GET /api/preview/<printer-id>.png`: plate preview of the current job (503 while loading)

## Troubleshooting

| Dashboard shows | Likely cause |
|---|---|
| **Offline** · "Cannot reach …" | Wrong IP, printer off, or computer on a different network/VLAN. Try `ping <ip>` |
| **Offline** · "MQTT refused" | Wrong access code (it changes if you toggle LAN mode) or Developer Mode needed |
| **Online** but no data | Wrong serial number (the topic name uses it) |
| **Quiet** | Connected, but the printer hasn't sent anything recently; normal for an idle P1/A1. The daemon re-requests state automatically |
| Camera: "is LAN Mode Liveview enabled" | X1/H2/P2S: turn on LAN Mode Liveview on the printer |
| Camera: "ffmpeg not found" | X1/H2/P2S: install ffmpeg and restart the daemon |
| Camera: "wrong access code?" | Access code changed; update `config.json` |
| No plate preview | Hover the icon to see why. Usually the job was sent as `.gcode`, or the file was deleted from the printer |

## Security

`config.json` holds your printers' access codes: keep it private (`chmod 600` on Linux/macOS). The web server only serves the dashboard files and the API, never the config, code or database. There is no login, so keep `bindAddress` at `127.0.0.1` unless you trust your LAN. That matters even more with the camera: anyone who can open the dashboard can see it.

## Notes

Payloads vary by model and firmware; anything a printer doesn't report shows as "—" (P1/A1 have no chamber sensor).
