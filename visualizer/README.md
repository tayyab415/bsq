# Visualizer

Interactive **3D skeleton + BSQ panel** for reviewing individual shots.

## Layout

```text
visualizer/
  web/                    # shooting.html, shooting.js, Three.js (sync from aws/web/visualizer)
  scripts/
    serve.sh              # starts HTTP server + API
    serve_visualizer.py   # API: /api/shooting/* (sync from aws/scripts/)
```

## Run

From repo root (after metrics exist):

```bash
./visualizer/scripts/serve.sh
```

Open **http://127.0.0.1:8765/visualizer/shooting.html**

## API dependencies

The server reads:

- `metrics-calculation/outputs/<match>/scores_v1.csv`
- `metrics-calculation/outputs/<match>/features.csv`
- Live S3 parquet chunks for skeleton frames (same credentials as metrics)

Configure paths via environment variables in `serve_visualizer.py` after sync.

## Relation to videos

Remotion compositions in `shooting-videos/` re-implement telestration for export. The visualizer is the **interactive** review tool; videos are **broadcast-style** outputs for the presentation deliverable.
