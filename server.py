#!/usr/bin/env python3
"""Bambu LAN Monitor Pro v2.1

Local, read-only daemon that watches two or more Bambu Lab printers over
LAN MQTT and serves a dashboard to your browser. No cloud, no external services.

- Python 3.10+
- paho-mqtt TLS connection to each printer (port 8883, user "bblp", LAN access code)
- Flask API + static dashboard, served by Waitress when installed
- Optional SQLite history (standard-library sqlite3)
- Plate preview image read from the job's .3mf over the printer's FTPS (port 990)
- Live camera snapshots: TLS JPEG stream on port 6000 (P1/A1) or RTSPS on port 322 via ffmpeg (X1/H2)
"""

from __future__ import annotations

import argparse
import ftplib
import json
import logging
import os
import re
import shutil
import signal
import socket
import sqlite3
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote

from flask import Flask, Response, abort, jsonify, request, send_from_directory
import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT / "config.json"
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "static"
VERSION = "2.1.0"
CAMERA_MODES = ("auto", "tcp", "rtsp", "off")
CAMERA_IDLE_SECONDS = 30
CAMERA_FRAME_MAX_AGE = 15
JPEG_START, JPEG_END = b"\xff\xd8", b"\xff\xd9"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("bambu-monitor")


# --------------------------------------------------------------------------- config

def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Missing {path.name}. Copy config.example.json to config.json and edit it.")
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid {path.name}: {exc}") from exc

    printers = config.get("printers")
    if not isinstance(printers, list) or not printers:
        raise SystemExit("config.json must contain a non-empty printers array.")
    serials: set[str] = set()
    for index, printer in enumerate(printers):
        if not isinstance(printer, dict):
            raise SystemExit(f"printers[{index}] must be an object.")
        printer.setdefault("name", f"Printer {index + 1}")
        for key in ("ip", "serial", "accessCode"):
            value = str(printer.get(key, "")).strip()
            if not value or value.upper().startswith(("YOUR_", "REPLACE_ME")):
                raise SystemExit(f"Missing or placeholder value: printers[{index}].{key} ({printer['name']})")
            printer[key] = value
        if printer["serial"] in serials:
            raise SystemExit(f"Duplicate serial in printers[{index}] ({printer['name']})")
        serials.add(printer["serial"])
        printer["port"] = int(printer.get("port", 8883))
        camera = "off" if printer.get("camera") is False else str(printer.get("camera", "auto")).strip().lower()
        if camera not in CAMERA_MODES:
            raise SystemExit(f"printers[{index}].camera must be one of {', '.join(CAMERA_MODES)} ({printer['name']})")
        printer["camera"] = camera
    return config


# --------------------------------------------------------------------------- helpers

def as_number(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
        return int(number) if number.is_integer() else round(number, 1)
    except (TypeError, ValueError):
        return None


def deep_merge(target: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Merge a partial MQTT report into the cached printer state (P1/A1 send deltas)."""
    for key, value in (source or {}).items():
        if isinstance(value, dict):
            existing = target.get(key)
            if not isinstance(existing, dict):
                existing = {}
                target[key] = existing
            deep_merge(existing, value)
        else:
            target[key] = value
    return target


def normalize_color(value: Any) -> str:
    color = str(value or "").strip().lstrip("#")
    if len(color) == 8:
        color = color[:6]
    if len(color) == 6 and all(c in "0123456789abcdefABCDEF" for c in color):
        return f"#{color}"
    return "#666666"


def state_is_printing(state: Any) -> bool:
    return str(state or "").upper() in {"RUNNING", "PRINTING", "PREPARE", "PAUSE", "SLICING"}


def state_is_terminal(state: Any) -> bool:
    return str(state or "").upper() in {
        "FINISH", "FINISHED", "COMPLETED", "SUCCESS", "FAILED", "ERROR", "CANCEL", "CANCELLED", "IDLE",
    }


def has_error(value: Any) -> bool:
    return value not in (None, "", 0, "0")


def extract_ams(print_state: dict[str, Any]) -> tuple[Any, list[dict[str, Any]]]:
    ams_root = print_state.get("ams") if isinstance(print_state.get("ams"), dict) else {}
    units = ams_root.get("ams") if isinstance(ams_root.get("ams"), list) else []
    active_tray = ams_root.get("tray_now", ams_root.get("tray_target"))
    slots: list[dict[str, Any]] = []
    for unit in units:
        if not isinstance(unit, dict):
            continue
        trays = unit.get("tray") if isinstance(unit.get("tray"), list) else []
        for tray in trays:
            if not isinstance(tray, dict):
                continue
            unit_id = as_number(unit.get("id"))
            slot_id = as_number(tray.get("id"))
            # Global tray index as reported in tray_now: unit * 4 + slot.
            global_index = unit_id * 4 + slot_id if isinstance(unit_id, int) and isinstance(slot_id, int) else None
            loaded = any(tray.get(key) not in (None, "") for key in ("tray_type", "tray_sub_brands", "tray_info_idx"))
            remain = as_number(tray.get("remain"))
            slots.append({
                "unitId": unit_id,
                "slotId": slot_id,
                "color": normalize_color(tray.get("tray_color")),
                "type": tray.get("tray_type") or None,
                "material": tray.get("tray_sub_brands") or None,
                "remaining": remain if isinstance(remain, (int, float)) and remain >= 0 else None,
                "humidity": as_number(unit.get("humidity")),
                "temperature": as_number(unit.get("temp")),
                "loaded": loaded,
                "active": active_tray is not None and global_index is not None and str(active_tray) == str(global_index),
            })
    return active_tray, slots


def read_exact(sock: socket.socket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("camera closed the connection (wrong access code?)")
        data += chunk
    return bytes(data)


# --------------------------------------------------------------------------- camera

class CameraFeed:
    """Pulls frames from one printer's camera, only while someone is looking at it."""

    def __init__(self, cfg: dict[str, Any], stop_event: threading.Event):
        self.cfg = cfg
        self.stop_event = stop_event
        self.lock = threading.Lock()
        self.frame: bytes | None = None
        self.frame_at = 0.0
        self.error: str | None = None
        self.last_viewed = 0.0
        self.thread: threading.Thread | None = None
        self.process: subprocess.Popen | None = None

    def stop(self) -> None:
        # The printer allows few RTSP viewers; a leftover ffmpeg would block the next daemon.
        process = self.process
        if process is not None and process.poll() is None:
            process.kill()

    def snapshot(self) -> tuple[bytes | None, str | None]:
        with self.lock:
            self.last_viewed = time.time()
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, daemon=True, name=f"camera-{self.cfg['name']}")
                self.thread.start()
            fresh = time.time() - self.frame_at < CAMERA_FRAME_MAX_AGE
            return (self.frame if fresh else None), self.error

    def _watched(self) -> bool:
        return not self.stop_event.is_set() and time.time() - self.last_viewed < CAMERA_IDLE_SECONDS

    def _store(self, frame: bytes) -> None:
        with self.lock:
            self.frame = frame
            self.frame_at = time.time()
            self.error = None

    def _transport(self) -> str:
        if self.cfg["camera"] != "auto":
            return self.cfg["camera"]
        model = str(self.cfg.get("model") or "").upper().replace(" ", "")
        if model.startswith(("P1", "A1")):
            return "tcp"
        if model.startswith(("X1", "H2", "P2")):
            return "rtsp"
        # Unknown model: RTSP (port 322) is open when Liveview is on; P2S also listens on 6000 but rejects
        # the P1/A1 login, so check 322 first. P1/A1 only have 6000.
        for port, transport in ((322, "rtsp"), (6000, "tcp")):
            try:
                with socket.create_connection((self.cfg["ip"], port), timeout=3):
                    return transport
            except OSError:
                pass
        return "rtsp"

    def _run(self) -> None:
        while self._watched():
            try:
                if self._transport() == "tcp":
                    self._run_tcp()
                else:
                    self._run_rtsp()
            except Exception as exc:
                with self.lock:
                    self.error = str(exc) or type(exc).__name__
                LOG.warning("[%s] camera: %s", self.cfg["name"], self.error)
            if self._watched():
                self.stop_event.wait(5)
        with self.lock:
            self.frame = None

    def _run_tcp(self) -> None:
        """P1/A1: TLS on port 6000, an 80-byte login, then 16-byte header + JPEG per frame."""
        ip = self.cfg["ip"]
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        try:
            raw = socket.create_connection((ip, 6000), timeout=10)
        except OSError as exc:
            raise ConnectionError(f"Cannot reach camera at {ip}:6000 ({exc})") from exc
        with raw, context.wrap_socket(raw, server_hostname=ip) as sock:
            sock.sendall(struct.pack("<IIII", 0x40, 0x3000, 0, 0)
                         + b"bblp".ljust(32, b"\0") + self.cfg["accessCode"].encode().ljust(32, b"\0"))
            while self._watched():
                size = int.from_bytes(read_exact(sock, 16)[:4], "little")
                if not 0 < size < 10_000_000:
                    raise ConnectionError(f"unexpected camera frame size {size}")
                payload = read_exact(sock, size)
                if payload.startswith(JPEG_START) and payload.endswith(JPEG_END):
                    self._store(payload)

    def _run_rtsp(self) -> None:
        """X1/H2: RTSPS on port 322, converted to JPEG frames by ffmpeg."""
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found; install it to see this printer's camera (RTSP)")
        url = f"rtsps://bblp:{quote(self.cfg['accessCode'], safe='')}@{self.cfg['ip']}:322/streaming/live/1"
        process = subprocess.Popen(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "10000000",
             "-i", url, "-an", "-vf", "fps=2", "-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "-"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.process = process
        got_frame = False
        try:
            buffer = b""
            while self._watched():
                chunk = process.stdout.read1(65536)
                if not chunk:
                    break
                buffer += chunk
                while (start := buffer.find(JPEG_START)) >= 0 and (end := buffer.find(JPEG_END, start + 2)) >= 0:
                    self._store(buffer[start:end + 2])
                    got_frame = True
                    buffer = buffer[end + 2:]
                if len(buffer) > 10_000_000:
                    buffer = b""
        finally:
            process.kill()
            _, stderr = process.communicate()
            self.process = None
        if self._watched():
            detail = stderr.decode("utf-8", "replace").strip().splitlines()
            hint = "" if got_frame else " (is LAN Mode Liveview enabled on the printer?)"
            raise ConnectionError(f"RTSP stream ended: {detail[-1] if detail else 'no data'}{hint}")


# --------------------------------------------------------------------------- plate preview

class ImplicitFTPS(ftplib.FTP_TLS):
    """Bambu printers speak implicit FTPS on port 990 and require TLS session reuse for data."""

    def __init__(self):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        super().__init__(context=context, timeout=15)
        self._sock: socket.socket | None = None

    @property
    def sock(self):
        return self._sock

    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value)
        self._sock = value

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(conn, server_hostname=self.host, session=self.sock.session)
        return conn, size


def job_stem(name: str) -> str:
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    for suffix in (".gcode.3mf", ".3mf", ".gcode"):
        if base.lower().endswith(suffix):
            return base[:-len(suffix)]
    return base


def fetch_plate_preview(cfg: dict[str, Any], subtask: str | None, gcode_file: str | None) -> bytes:
    """Download the job's .3mf from the printer and return its plate PNG."""
    wanted = {job_stem(n) for n in (subtask, gcode_file) if n and not n.startswith("/data/")}
    match = re.search(r"plate_(\d+)", gcode_file or "")
    plate = match.group(1) if match else "1"
    ftp = ImplicitFTPS()
    try:
        ftp.connect(cfg["ip"], 990)
        ftp.login("bblp", cfg["accessCode"])
        ftp.prot_p()
        path = None
        for folder in ("/", "/cache"):
            try:
                names = ftp.nlst(folder)
            except ftplib.error_perm:
                continue
            path = next((f"{folder.rstrip('/')}/{n.rsplit('/', 1)[-1]}" for n in names
                         if n.lower().endswith(".3mf") and job_stem(n) in wanted), None)
            if path:
                break
        if path is None:
            if (gcode_file or "").startswith("/data/"):
                raise FileNotFoundError(f"{subtask or gcode_file} was sent without saving it to the printer's storage, "
                                        "so there is no .3mf to read the preview from")
            raise FileNotFoundError(f"{subtask or gcode_file}.3mf not found on the printer")
        with tempfile.TemporaryFile() as tmp:
            ftp.retrbinary(f"RETR {path}", tmp.write)
            tmp.seek(0)
            with zipfile.ZipFile(tmp) as archive:
                names = archive.namelist()
                image = next((n for n in (f"Metadata/plate_{plate}.png", "Metadata/plate_1.png") if n in names),
                             next((n for n in names if re.fullmatch(r"Metadata/plate_\d+\.png", n)), None))
                if image is None:
                    raise FileNotFoundError("No plate preview inside the .3mf")
                return archive.read(image)
    finally:
        try:
            ftp.quit()
        except Exception:
            ftp.close()


class PlatePreview:
    """Caches one plate image per job; downloads in the background on first request."""

    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.key: tuple[Any, Any] | None = None
        self.image: bytes | None = None
        self.error: str | None = None
        self.failed_at = 0.0
        self.loading = False

    def get(self, subtask: str | None, gcode_file: str | None) -> tuple[bytes | None, str | None]:
        key = (subtask, gcode_file)
        with self.lock:
            if key != self.key:
                self.key, self.image, self.error, self.failed_at = key, None, None, 0.0
            retry = self.error is not None and time.time() - self.failed_at > 120
            if self.image is None and not self.loading and (self.error is None or retry):
                self.loading = True
                threading.Thread(target=self._load, args=(key,), daemon=True,
                                 name=f"preview-{self.cfg['name']}").start()
            return self.image, self.error

    def _load(self, key: tuple[Any, Any]) -> None:
        image, error = None, None
        try:
            image = fetch_plate_preview(self.cfg, *key)
        except Exception as exc:
            error = str(exc) or type(exc).__name__
            LOG.warning("[%s] plate preview: %s", self.cfg["name"], error)
        with self.lock:
            self.loading = False
            if key == self.key:
                self.image, self.error, self.failed_at = image, error, time.time()


# --------------------------------------------------------------------------- runtime

@dataclass
class PrinterRuntime:
    id: int
    config: dict[str, Any]
    connected: bool = False
    reconnects: int = 0
    updated_at: float | None = None
    last_pushall: float = 0.0
    last_error: str | None = None
    state: dict[str, Any] = field(default_factory=dict)
    last_report: dict[str, Any] | None = None
    last_state: str | None = None
    active_job: dict[str, Any] | None = None
    client: mqtt.Client | None = None
    camera: CameraFeed | None = None
    preview: PlatePreview | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)


class HistoryStore:
    def __init__(self, enabled: bool, retention_days: int):
        self.enabled = enabled
        self.retention_days = max(1, retention_days)
        self.path = DATA_DIR / "history.db"
        self.lock = threading.RLock()
        if enabled:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            self._initialize()
            LOG.info("SQLite history enabled: %s", self.path)
        else:
            LOG.info("SQLite history disabled")

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self.lock, closing(self.connect()) as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    printer_id INTEGER NOT NULL,
                    printer_name TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    progress REAL, nozzle REAL, bed REAL, chamber REAL,
                    state TEXT, error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_metrics_printer_time ON metrics(printer_id, timestamp);
                CREATE TABLE IF NOT EXISTS jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    printer_id INTEGER NOT NULL,
                    printer_name TEXT NOT NULL,
                    filename TEXT,
                    started INTEGER,
                    completed INTEGER NOT NULL,
                    final_state TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_jobs_completed ON jobs(completed);
            """)
            connection.commit()

    def record_metrics(self, rows: list[tuple[Any, ...]]) -> None:
        if not self.enabled or not rows:
            return
        with self.lock, closing(self.connect()) as connection:
            connection.executemany("""
                INSERT INTO metrics
                (printer_id, printer_name, timestamp, progress, nozzle, bed, chamber, state, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
            connection.commit()

    def record_job(self, values: tuple[Any, ...]) -> None:
        if not self.enabled:
            return
        with self.lock, closing(self.connect()) as connection:
            connection.execute("""
                INSERT INTO jobs (printer_id, printer_name, filename, started, completed, final_state)
                VALUES (?, ?, ?, ?, ?, ?)
            """, values)
            connection.commit()

    def history(self, printer_id: int, since: int, limit: int) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        with self.lock, closing(self.connect()) as connection:
            rows = connection.execute("""
                SELECT timestamp, progress, nozzle, bed, chamber, state, error FROM (
                    SELECT * FROM metrics WHERE printer_id = ? AND timestamp >= ?
                    ORDER BY timestamp DESC LIMIT ?
                ) ORDER BY timestamp ASC
            """, (printer_id, since, limit)).fetchall()
            return [dict(row) for row in rows]

    def jobs(self, limit: int) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        with self.lock, closing(self.connect()) as connection:
            rows = connection.execute("""
                SELECT id, printer_id AS printerId, printer_name AS printerName,
                       filename, started, completed, final_state AS finalState
                FROM jobs ORDER BY completed DESC LIMIT ?
            """, (limit,)).fetchall()
            return [dict(row) for row in rows]

    def purge(self) -> None:
        if not self.enabled:
            return
        cutoff = int((time.time() - self.retention_days * 86400) * 1000)
        with self.lock, closing(self.connect()) as connection:
            connection.execute("DELETE FROM metrics WHERE timestamp < ?", (cutoff,))
            connection.execute("DELETE FROM jobs WHERE completed < ?", (cutoff,))
            connection.commit()


class BambuMonitor:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.stale_seconds = max(5, int(config.get("staleAfterSeconds", 60)))
        self.pushall_min_interval = max(30, int(config.get("pushallMinIntervalSeconds", 120)))
        self.expose_raw = config.get("exposeRawReports", True) is not False
        self.history_interval = max(10, int(config.get("historyIntervalSeconds", 30)))
        self.verify_tls = config.get("verifyTls") is True
        self.history = HistoryStore(
            enabled=config.get("enableHistory") is True,
            retention_days=int(config.get("historyRetentionDays", 30)),
        )
        self.printers = [PrinterRuntime(i + 1, item) for i, item in enumerate(config["printers"])]
        self.stop_event = threading.Event()
        for printer in self.printers:
            if printer.config["camera"] != "off":
                printer.camera = CameraFeed(printer.config, self.stop_event)
            if config.get("enablePlatePreview", True) is not False:
                printer.preview = PlatePreview(printer.config)
        self.threads: list[threading.Thread] = []
        self.started_at = time.time()

    # -- lifecycle --------------------------------------------------------

    def start(self) -> None:
        for printer in self.printers:
            self._connect_printer(printer)
        self._spawn(self._watchdog_loop, "watchdog")
        if self.history.enabled:
            self.history.purge()
            self._spawn(self._history_loop, "history-recorder")

    def _spawn(self, target, name: str) -> None:
        thread = threading.Thread(target=target, daemon=True, name=name)
        thread.start()
        self.threads.append(thread)

    def shutdown(self) -> None:
        if self.stop_event.is_set():
            return
        LOG.info("Shutting down…")
        self.stop_event.set()
        if self.history.enabled:
            try:
                self.record_metrics()
            except Exception:
                LOG.exception("Final history write failed")
        for printer in self.printers:
            if printer.camera:
                printer.camera.stop()
            if printer.client:
                try:
                    printer.client.disconnect()
                    printer.client.loop_stop()
                except Exception:
                    LOG.exception("[%s] MQTT shutdown failed", printer.config["name"])

    # -- MQTT -------------------------------------------------------------

    def _new_client(self, printer: PrinterRuntime) -> mqtt.Client:
        client_id = f"bambu-monitor-{printer.id}-{os.getpid()}-{int(time.time())}"
        try:
            return mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        except AttributeError:  # paho-mqtt 1.x
            return mqtt.Client(client_id=client_id)

    def _request_pushall(self, printer: PrinterRuntime) -> None:
        client = printer.client
        if client is None:
            return
        payload = json.dumps({"pushing": {"sequence_id": str(int(time.time() * 1000)), "command": "pushall"}})
        client.publish(f"device/{printer.config['serial']}/request", payload, qos=0)
        with printer.lock:
            printer.last_pushall = time.time()

    def _connect_printer(self, printer: PrinterRuntime) -> None:
        cfg = printer.config
        client = self._new_client(printer)
        client.username_pw_set("bblp", cfg["accessCode"])
        # Bambu printers use a self-signed certificate on the LAN MQTT port.
        if self.verify_tls and cfg.get("caFile"):
            client.tls_set(ca_certs=cfg["caFile"], cert_reqs=ssl.CERT_REQUIRED)
        else:
            client.tls_set(cert_reqs=ssl.CERT_NONE)
            client.tls_insecure_set(True)
        client.reconnect_delay_set(min_delay=2, max_delay=30)
        report_topic = f"device/{cfg['serial']}/report"

        def on_connect(client_obj, _userdata, _flags, reason_code, _properties=None):
            code = getattr(reason_code, "value", reason_code)
            success = int(code) == 0
            with printer.lock:
                printer.connected = success
                printer.last_error = None if success else f"MQTT refused: {reason_code}"
            if not success:
                LOG.error("[%s] MQTT connection refused: %s (check access code / LAN mode)", cfg["name"], reason_code)
                return
            LOG.info("[%s] connected to %s:%s", cfg["name"], cfg["ip"], cfg["port"])
            client_obj.subscribe(report_topic, qos=0)
            self._request_pushall(printer)

        def on_disconnect(_client, _userdata, *args):
            with printer.lock:
                was_connected = printer.connected
                printer.connected = False
                if was_connected and not self.stop_event.is_set():
                    printer.reconnects += 1
            if was_connected and not self.stop_event.is_set():
                LOG.warning("[%s] disconnected; retrying", cfg["name"])

        def on_message(_client, _userdata, message):
            if message.topic != report_topic or not message.payload:
                return
            try:
                report = json.loads(message.payload.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                LOG.warning("[%s] invalid MQTT JSON: %s", cfg["name"], exc)
                return
            if not isinstance(report, dict):
                return
            with printer.lock:
                printer.last_report = report
                printer.updated_at = time.time()
                deep_merge(printer.state, report)
                try:
                    self._track_job(printer)
                except Exception:
                    LOG.exception("[%s] job tracking failed", cfg["name"])

        def on_connect_fail(_client, _userdata):
            with printer.lock:
                printer.connected = False
                printer.last_error = f"Cannot reach {cfg['ip']}:{cfg['port']} (powered off, wrong IP, or LAN access disabled?)"

        client.on_connect = on_connect
        client.on_connect_fail = on_connect_fail
        client.on_disconnect = on_disconnect
        client.on_message = on_message
        printer.client = client
        try:
            client.connect_async(cfg["ip"], cfg["port"], keepalive=60)
            client.loop_start()  # retries the first connection and every drop automatically
        except Exception as exc:
            printer.last_error = str(exc)
            LOG.error("[%s] failed to start MQTT connection: %s", cfg["name"], exc)

    def _watchdog_loop(self) -> None:
        """Idle P1/A1 printers can go quiet; politely ask for a full state when stale."""
        while not self.stop_event.wait(5):
            now = time.time()
            for printer in self.printers:
                with printer.lock:
                    quiet = printer.updated_at is None or now - printer.updated_at > self.stale_seconds
                    due = now - printer.last_pushall > self.pushall_min_interval
                    connected = printer.connected
                if connected and quiet and due:
                    try:
                        self._request_pushall(printer)
                    except Exception:
                        LOG.exception("[%s] pushall failed", printer.config["name"])

    def _track_job(self, printer: PrinterRuntime) -> None:
        print_state = printer.state.get("print", {})
        current = print_state.get("gcode_state")
        filename = print_state.get("subtask_name") or print_state.get("gcode_file")
        now_ms = int(time.time() * 1000)
        if state_is_printing(current):
            if printer.active_job is None or (filename and printer.active_job.get("filename") != filename):
                printer.active_job = {"filename": filename, "started": now_ms}
        elif printer.active_job and state_is_printing(printer.last_state) and state_is_terminal(current):
            self.history.record_job((
                printer.id, printer.config["name"], printer.active_job.get("filename") or filename,
                printer.active_job.get("started"), now_ms, str(current),
            ))
            LOG.info("[%s] job '%s' ended: %s", printer.config["name"], printer.active_job.get("filename"), current)
            printer.active_job = None
        printer.last_state = current

    # -- history ----------------------------------------------------------

    def _history_loop(self) -> None:
        last_purge = time.time()
        while not self.stop_event.wait(self.history_interval):
            try:
                self.record_metrics()
                if time.time() - last_purge > 6 * 3600:
                    self.history.purge()
                    last_purge = time.time()
            except Exception:
                LOG.exception("History recording failed")

    def record_metrics(self) -> None:
        now_ms = int(time.time() * 1000)
        rows = []
        for printer in self.printers:
            if printer.updated_at is None:
                continue
            status = self.public_status(printer)
            rows.append((
                printer.id, printer.config["name"], now_ms, status["progress"], status["nozzleTemp"],
                status["bedTemp"], status["chamberTemp"], status["state"],
                None if status["printError"] is None else str(status["printError"]),
            ))
        self.history.record_metrics(rows)

    # -- API views --------------------------------------------------------

    def public_status(self, printer: PrinterRuntime) -> dict[str, Any]:
        with printer.lock:
            print_state = printer.state.get("print") if isinstance(printer.state.get("print"), dict) else {}
            active_tray, ams = extract_ams(print_state)
            stale = printer.updated_at is None or time.time() - printer.updated_at > self.stale_seconds
            result = {
                "id": printer.id,
                "name": printer.config["name"],
                "ip": printer.config["ip"],
                "model": printer.config.get("model"),
                "connected": printer.connected,
                "camera": printer.camera is not None,
                "platePreview": printer.preview is not None,
                "stale": stale,
                "reconnects": printer.reconnects,
                "lastError": printer.last_error,
                "updatedAt": None if printer.updated_at is None
                else time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(printer.updated_at)),
                "state": print_state.get("gcode_state"),
                "file": print_state.get("subtask_name") or print_state.get("gcode_file"),
                "progress": as_number(print_state.get("mc_percent")),
                "remainingMinutes": as_number(print_state.get("mc_remaining_time")),
                "layer": as_number(print_state.get("layer_num")),
                "totalLayers": as_number(print_state.get("total_layer_num")),
                "nozzleTemp": as_number(print_state.get("nozzle_temper")),
                "nozzleTarget": as_number(print_state.get("nozzle_target_temper")),
                "bedTemp": as_number(print_state.get("bed_temper")),
                "bedTarget": as_number(print_state.get("bed_target_temper")),
                "chamberTemp": as_number(print_state.get("chamber_temper")),
                "wifiSignal": print_state.get("wifi_signal"),
                "speedLevel": print_state.get("spd_lvl"),
                "printError": print_state.get("print_error"),
                "hmsCount": len(print_state.get("hms") or []) if isinstance(print_state.get("hms"), list) else 0,
                "activeTray": active_tray,
                "ams": ams,
            }
            if self.expose_raw:
                result["raw"] = printer.last_report
            return result

    def statuses(self) -> list[dict[str, Any]]:
        return [self.public_status(p) for p in self.printers]

    def summary(self) -> dict[str, Any]:
        statuses = self.statuses()
        return {
            "online": sum(1 for s in statuses if s["connected"]),
            "stale": sum(1 for s in statuses if s["connected"] and s["stale"]),
            "total": len(statuses),
            "activePrints": sum(1 for s in statuses if state_is_printing(s["state"])),
            "amsSlots": sum(1 for s in statuses for slot in s["ams"] if slot["loaded"]),
            "errors": sum(1 for s in statuses if has_error(s["printError"])),
            "historyEnabled": self.history.enabled,
        }


# --------------------------------------------------------------------------- web app

def create_app(monitor: BambuMonitor) -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'"
        )
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/<any('styles.css','app.js'):name>")
    def static_file(name: str):
        return send_from_directory(STATIC_DIR, name)

    @app.get("/api/health")
    def api_health():
        return jsonify({
            "ok": True,
            "version": VERSION,
            "uptimeSeconds": int(time.time() - monitor.started_at),
            "historyEnabled": monitor.history.enabled,
            "printers": [
                {k: s[k] for k in ("id", "name", "connected", "stale", "updatedAt", "lastError")}
                for s in monitor.statuses()
            ],
        })

    @app.get("/api/status")
    def api_status():
        return jsonify(monitor.statuses())

    @app.get("/api/summary")
    def api_summary():
        return jsonify(monitor.summary())

    @app.get("/api/history/<int:printer_id>")
    def api_history(printer_id: int):
        if not any(p.id == printer_id for p in monitor.printers):
            abort(404, description="Printer not found")
        if not monitor.history.enabled:
            return jsonify({"enabled": False, "rows": []})
        try:
            hours = min(max(float(request.args.get("hours", 24)), 0.1), monitor.history.retention_days * 24)
            limit = min(max(int(request.args.get("limit", 1000)), 1), 5000)
        except ValueError:
            abort(400, description="Invalid hours or limit")
        since = int((time.time() - hours * 3600) * 1000)
        return jsonify({"enabled": True, "printerId": printer_id, "hours": hours,
                        "rows": monitor.history.history(printer_id, since, limit)})

    @app.get("/api/camera/<int:printer_id>.jpg")
    def api_camera(printer_id: int):
        printer = next((p for p in monitor.printers if p.id == printer_id), None)
        if printer is None:
            abort(404, description="Printer not found")
        if printer.camera is None:
            abort(404, description="Camera disabled in config.json")
        frame, error = printer.camera.snapshot()
        if frame is None:
            return jsonify({"error": error or "Connecting to camera…"}), 503
        return Response(frame, mimetype="image/jpeg")

    @app.get("/api/preview/<int:printer_id>.png")
    def api_preview(printer_id: int):
        printer = next((p for p in monitor.printers if p.id == printer_id), None)
        if printer is None:
            abort(404, description="Printer not found")
        if printer.preview is None:
            abort(404, description="Plate preview disabled in config.json")
        with printer.lock:
            print_state = printer.state.get("print") if isinstance(printer.state.get("print"), dict) else {}
            subtask, gcode_file = print_state.get("subtask_name"), print_state.get("gcode_file")
        if not subtask and not gcode_file:
            abort(404, description="No job on this printer")
        image, error = printer.preview.get(subtask, gcode_file)
        if image is None:
            return jsonify({"error": error or "Loading plate preview…"}), 503
        return Response(image, mimetype="image/png")

    @app.get("/api/jobs")
    def api_jobs():
        if not monitor.history.enabled:
            return jsonify({"enabled": False, "rows": []})
        try:
            limit = min(max(int(request.args.get("limit", 50)), 1), 500)
        except ValueError:
            abort(400, description="Invalid limit")
        return jsonify({"enabled": True, "rows": monitor.history.jobs(limit)})

    @app.errorhandler(400)
    @app.errorhandler(404)
    def client_error(error):
        return jsonify({"error": getattr(error, "description", "Bad request")}), error.code

    @app.errorhandler(500)
    def server_error(_error):
        return jsonify({"error": "Internal server error"}), 500

    return app


def serve(app: Flask, host: str, port: int) -> None:
    try:
        from waitress import serve as waitress_serve
    except ImportError:
        LOG.warning("waitress not installed; using Flask's built-in server")
        app.run(host=host, port=port, debug=False, threaded=True, use_reloader=False)
        return
    waitress_serve(app, host=host, port=port, threads=8, ident="bambu-monitor")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Bambu Lab multi-printer dashboard daemon")
    parser.add_argument("-c", "--config", type=Path, default=DEFAULT_CONFIG_PATH, help="path to config.json")
    parser.add_argument("--check", action="store_true", help="validate the config and exit")
    args = parser.parse_args()

    config = load_config(args.config.resolve())
    if args.check:
        print(f"Config OK: {len(config['printers'])} printer(s): "
              + ", ".join(p["name"] for p in config["printers"]))
        return

    monitor = BambuMonitor(config)
    app = create_app(monitor)

    def stop_handler(signum, _frame):
        monitor.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    monitor.start()
    host = str(config.get("bindAddress", "127.0.0.1"))
    port = int(config.get("webPort", 8787))
    LOG.info("Bambu LAN Monitor %s: watching %d printer(s)", VERSION, len(monitor.printers))
    LOG.info("Dashboard: http://%s:%s", "localhost" if host in ("0.0.0.0", "::") else host, port)
    try:
        serve(app, host, port)
    finally:
        monitor.shutdown()


if __name__ == "__main__":
    main()
