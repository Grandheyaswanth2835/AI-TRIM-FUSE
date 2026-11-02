#!/usr/bin/env python3
"""Read-only JSON API for the synthetic trim-and-fuse datasets."""

from __future__ import annotations

import csv
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "Dataset" / "trimfuse_synthetic_dataset" / "trimfuse_synth" / "data"
BASELINE_FILE = ROOT_DIR / "Dataset" / "trimfuse_synthetic_dataset" / "trimfuse_synth" / "baseline_results.txt"
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8765"))
MAX_PAGE_SIZE = 100
LOCAL_ORIGINS = {
    "http://localhost:5500",
    "http://127.0.0.1:5500",
}
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
} or LOCAL_ORIGINS

DATASETS = {
    "mcu-fuse-map-audit": ("MCU fuse-map audit", "Fuse-map validation samples and injected error labels.", "mcu_fuse_map_audit.csv"),
    "mcu-fuse-schema": ("MCU fuse schema", "Fuse-word field definitions for MCU derivatives.", "mcu_fuse_schema.csv"),
    "mcu-trim-fuse": ("MCU trim and fuse", "MCU trim measurements, optimal codes, and final-test results.", "mcu_trim_fuse.csv"),
    "memory-repair-bitmaps": ("Memory repair bitmaps", "Memory failure maps and repair allocation outcomes.", "memory_repair_bitmaps.csv"),
    "pmic-otp-config-requests": ("PMIC OTP requests", "Customer OTP configuration requests and validation labels.", "pmic_otp_config_requests.csv"),
    "pmic-trim-otp": ("PMIC trim and OTP", "PMIC rail trims, OTP images, and test results.", "pmic_trim_otp.csv"),
    "sensor-calibration": ("Sensor calibration", "Sensor calibration measurements and temperature coefficients.", "sensor_calibration.csv"),
    "soc-binning-harvesting": ("SoC binning and harvesting", "SoC performance, repair, and SKU assignment data.", "soc_binning_harvesting.csv"),
    "soc-sku-demand": ("SoC SKU demand", "SKU specifications, prices, and weekly demand.", "soc_sku_demand.csv"),
}

_dataset_cache: dict[str, dict[str, object]] = {}


def read_dataset_page(slug: str, search: str, limit: int, offset: int) -> dict[str, object]:
    """Return one filtered CSV page, exposing only datasets in the allowlist."""
    if slug not in DATASETS:
        raise KeyError(slug)

    title, description, filename = DATASETS[slug]
    path = DATA_DIR / filename
    records: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        columns = reader.fieldnames or []
        needle = search.casefold()
        total = 0
        for row in reader:
            if needle and not any(needle in (value or "").casefold() for value in row.values()):
                continue
            if total >= offset and len(records) < limit:
                records.append(dict(row))
            total += 1

    return {
        "slug": slug,
        "name": title,
        "description": description,
        "columns": columns,
        "rows": records,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def dataset_summaries() -> list[dict[str, object]]:
    summaries = []
    for slug, (title, description, filename) in DATASETS.items():
        path = DATA_DIR / filename
        signature = (path.stat().st_mtime_ns, path.stat().st_size)
        cached = _dataset_cache.get(slug)
        if cached is None or cached["signature"] != signature:
            with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
                reader = csv.DictReader(csv_file)
                columns = reader.fieldnames or []
                row_count = sum(1 for _ in reader)
            cached = {
                "signature": signature,
                "columns": columns,
                "row_count": row_count,
            }
            _dataset_cache[slug] = cached
        summaries.append({
            "slug": slug,
            "name": title,
            "description": description,
            "rows": cached["row_count"],
            "column_count": len(cached["columns"]),
        })
    return summaries


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "TrimFuseAPI/1.0"

    def _send(self, status: int, payload: object, content_type: str = "application/json; charset=utf-8") -> None:
        body = payload.encode("utf-8") if isinstance(payload, str) else json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send(200, {"status": "ok"})
            return
        if parsed.path == "/api/datasets":
            try:
                self._send(200, {"datasets": dataset_summaries()})
            except OSError:
                self._send(500, {"error": "Dataset files are unavailable. Check the Dataset folder."})
            return
        if parsed.path == "/api/baseline":
            try:
                self._send(200, BASELINE_FILE.read_text(encoding="utf-8"), "text/plain; charset=utf-8")
            except OSError:
                self._send(404, {"error": "Baseline results file was not found."})
            return

        prefix = "/api/datasets/"
        suffix = "/rows"
        if parsed.path.startswith(prefix) and parsed.path.endswith(suffix):
            slug = unquote(parsed.path[len(prefix):-len(suffix)])
            query = parse_qs(parsed.query)
            try:
                limit = int(query.get("limit", ["25"])[0])
                offset = int(query.get("offset", ["0"])[0])
                if limit < 1 or limit > MAX_PAGE_SIZE or offset < 0:
                    raise ValueError
            except ValueError:
                self._send(400, {"error": f"limit must be 1-{MAX_PAGE_SIZE} and offset must be zero or greater."})
                return
            search = query.get("search", [""])[0].strip()
            try:
                self._send(200, read_dataset_page(slug, search, limit, offset))
            except KeyError:
                self._send(404, {"error": "Unknown dataset."})
            except OSError:
                self._send(500, {"error": "Could not read the selected dataset."})
            return

        self._send(404, {"error": "API route not found."})

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    if not DATA_DIR.is_dir():
        raise FileNotFoundError(f"Dataset directory not found: {DATA_DIR}")
    server = ThreadingHTTPServer((HOST, PORT), ApiHandler)
    print(f"Trim & Fuse API listening at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping API server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
