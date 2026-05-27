from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from aws_football import bsq_leaderboards_v2 as v2


def test_rasterize_logo_repairs_square_quicklook_thumbnail_for_wide_svg(tmp_path, monkeypatch):
    logo_dir = tmp_path / "logos"
    logo_dir.mkdir()
    svg = logo_dir / "wide.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">'
        '<rect width="400" height="200" fill="red"/></svg>'
    )

    monkeypatch.setattr(v2, "resolve_logo_dir", lambda: logo_dir)
    monkeypatch.setattr(v2.shutil, "which", lambda name: None)

    def fake_run(cmd, **kwargs):
        if cmd[0] == "qlmanage":
            out_dir = Path(cmd[cmd.index("-o") + 1])
            Image.new("RGBA", (512, 512), (255, 0, 0, 255)).save(out_dir / f"{svg.name}.png")
            return SimpleNamespace(returncode=0)
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr(v2.subprocess, "run", fake_run)

    out = v2._rasterize_logo(svg)
    img = Image.open(out)

    assert img.size == (512, 256)
