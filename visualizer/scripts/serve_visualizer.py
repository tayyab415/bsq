#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC = REPO_ROOT / "src"
STATIC_ROOT = REPO_ROOT / "visualizer" / "web"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from aws_football.visualizer import ShootingReviewService, VisualizerService  # noqa: E402


class VisualizerHandler(SimpleHTTPRequestHandler):
    service: VisualizerService
    shooting_service: ShootingReviewService

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed.path, parse_qs(parsed.query))
            return
        self._handle_static(parsed.path)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib handler API
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _handle_api(self, path: str, query: dict[str, list[str]]) -> None:
        try:
            if path == "/api/match":
                self._send_json(self.service.match_payload())
                return
            if path == "/api/events":
                start = _parse_int(query, "startFrame", self.service.default_frame() - 250)
                end = _parse_int(query, "endFrame", self.service.default_frame() + 250)
                self._send_json(self.service.events_payload(start, end))
                return
            if path == "/api/event":
                event_id = _parse_text(query, "eventId")
                self._send_json(self.service.event_payload(event_id))
                return
            if path == "/api/frame":
                frame = _parse_int(query, "frame", self.service.default_frame())
                self._send_json(self.service.frame_payload(frame))
                return
            if path == "/api/chunk":
                start = _parse_int(query, "startFrame", self.service.default_frame())
                end = _parse_int(query, "endFrame", start + 100)
                stride = _parse_int(query, "stride", 2)
                self._send_json(self.service.chunk_payload(start, end, stride=stride))
                return
            if path == "/api/position":
                frame = _parse_int(query, "frame", self.service.default_frame())
                self._send_json(self.service.position_payload(frame))
                return
            if path == "/api/shooting/summary":
                self._send_json(self.shooting_service.summary_payload())
                return
            if path == "/api/shooting/shot":
                event_id = _parse_text(query, "eventId")
                match_folder = _parse_optional_text(query, "matchFolder", "Bayern_Hamburg")
                self._send_json(self.shooting_service.shot_payload(match_folder, event_id))
                return
            if path == "/api/shooting/frame":
                match_folder = _parse_optional_text(query, "matchFolder", "Bayern_Hamburg")
                frame = _parse_int(query, "frame", self.service.default_frame())
                self._send_json(self.shooting_service.frame_payload(match_folder, frame))
                return
            if path == "/api/shooting/chunk":
                match_folder = _parse_optional_text(query, "matchFolder", "Bayern_Hamburg")
                start = _parse_int(query, "startFrame", self.service.default_frame())
                end = _parse_int(query, "endFrame", start + 80)
                stride = _parse_int(query, "stride", 2)
                self._send_json(self.shooting_service.chunk_payload(match_folder, start, end, stride=stride))
                return
            self._send_json({"error": f"Unknown API path: {path}"}, status=HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001 - API should return JSON errors instead of dropping the socket.
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)

    def _handle_static(self, path: str) -> None:
        relative = path.lstrip("/")
        if relative == "" or relative == "visualizer/shooting.html":
            relative = "shooting.html"
        elif relative.startswith("visualizer/"):
            relative = relative.removeprefix("visualizer/")
        target = (STATIC_ROOT / relative).resolve()
        if not str(target).startswith(str(STATIC_ROOT.resolve())) or not target.exists() or target.is_dir():
            self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", _content_type(target))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload: object, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _default_data_root() -> Path:
    env_root = os.environ.get("HACKATHON_DATA_ROOT")
    if env_root:
        return Path(env_root) / "Match_Data"
    legacy = os.environ.get("DATA_ROOT")
    if legacy:
        return Path(legacy)
    return REPO_ROOT / "data-small" / "Match_Data"


def _default_metrics_root() -> Path:
    env = os.environ.get("METRICS_ROOT")
    if env:
        return Path(env)
    return REPO_ROOT / "metrics-calculation" / "outputs" / "all_matches"


def main() -> int:
    args = _parse_args()
    service = VisualizerService(data_root=args.data_root, aws_profile=args.aws_profile)
    shooting_service = ShootingReviewService(
        data_root=args.data_root,
        review_dir=args.shooting_review_dir,
        aws_profile=args.aws_profile,
    )
    handler = type("BoundVisualizerHandler", (VisualizerHandler,), {"service": service, "shooting_service": shooting_service})
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving visualizer at http://{args.host}:{args.port}/visualizer/shooting.html")
    print(f"  data_root={args.data_root}")
    print(f"  metrics_root={args.shooting_review_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping visualizer server.")
    finally:
        server.server_close()
    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the shooting BSQ 3D visualizer.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--root", type=Path, default=REPO_ROOT, help="Repository root (final-repo)")
    parser.add_argument("--data-root", type=Path, default=None)
    parser.add_argument("--shooting-review-dir", type=Path, default=None)
    parser.add_argument("--aws-profile", default=os.environ.get("AWS_PROFILE", "hackathon"))
    args = parser.parse_args()
    if args.data_root is None:
        args.data_root = _default_data_root()
    if args.shooting_review_dir is None:
        args.shooting_review_dir = _default_metrics_root()
    return args


def _parse_int(query: dict[str, list[str]], name: str, default: int) -> int:
    values = query.get(name)
    if not values:
        return default
    try:
        return int(values[0])
    except ValueError as exc:
        raise ValueError(f"Query parameter {name!r} must be an integer") from exc


def _parse_text(query: dict[str, list[str]], name: str) -> str:
    values = query.get(name)
    if not values or not values[0].strip():
        raise ValueError(f"Query parameter {name!r} is required")
    return values[0].strip()


def _parse_optional_text(query: dict[str, list[str]], name: str, default: str) -> str:
    values = query.get(name)
    if not values or not values[0].strip():
        return default
    return values[0].strip()


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".js":
        return "text/javascript; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


if __name__ == "__main__":
    raise SystemExit(main())
