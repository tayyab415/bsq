"""Bundled Google Sans Flex (OFL) for matplotlib — matches aesthetics.md / Plotly notebooks."""

from __future__ import annotations

from pathlib import Path

from matplotlib import font_manager
from matplotlib.font_manager import FontProperties

FONTS_DIR = Path(__file__).resolve().parent / "fonts"

FONT_FILES: dict[int, str] = {
    400: "GoogleSansFlex-Regular.ttf",
    500: "GoogleSansFlex-Medium.ttf",
    600: "GoogleSansFlex-SemiBold.ttf",
    700: "GoogleSansFlex-Bold.ttf",
}

# Static latin-ext cuts from Google Fonts; family name in font metadata.
BSQ_MATPLOTLIB_FAMILY = "Google Sans Flex 18pt"
BSQ_FONT_FALLBACK = "DejaVu Sans"

_registered = False


def reset_matplotlib_fonts() -> None:
    """Clear registration flag (call after importlib.reload(bsq_fonts))."""
    global _registered
    _registered = False


def register_matplotlib_fonts() -> str:
    """Load bundled TTFs into matplotlib's font cache (idempotent)."""
    global _registered
    if _registered:
        return BSQ_MATPLOTLIB_FAMILY
    for filename in FONT_FILES.values():
        path = FONTS_DIR / filename
        if not path.is_file():
            raise FileNotFoundError(
                f"Missing bundled font {path}. "
                "Reinstall the package or restore src/aws_football/fonts/."
            )
        font_manager.fontManager.addfont(str(path))
    _registered = True
    return BSQ_MATPLOTLIB_FAMILY


def font_properties(weight: int = 400) -> FontProperties:
    """Bundled weight file + DejaVu fallback for rare glyphs (e.g. ō in player names)."""
    register_matplotlib_fonts()
    key = weight if weight in FONT_FILES else 400
    return FontProperties(
        fname=str(FONTS_DIR / FONT_FILES[key]),
        family=[BSQ_MATPLOTLIB_FAMILY, BSQ_FONT_FALLBACK],
    )


def apply_matplotlib_font_settings() -> None:
    """Set rcParams so axes ticks/labels use the bundled Google Sans Flex family."""
    import matplotlib.pyplot as plt

    family = register_matplotlib_fonts()
    families = [family, BSQ_FONT_FALLBACK]
    plt.rcParams.update(
        {
            "font.family": families,
            "font.sans-serif": [family, "Google Sans Flex", "Google Sans", BSQ_FONT_FALLBACK, "Arial"],
        }
    )


def matplotlib_font_status() -> str:
    """One-line summary for notebooks (confirms bundled font, not Arial fallback)."""
    from matplotlib import font_manager

    register_matplotlib_fonts()
    resolved = font_manager.findfont(BSQ_MATPLOTLIB_FAMILY, fallback_to_default=False)
    bundled = str(FONTS_DIR / FONT_FILES[400])
    ok = Path(resolved).resolve() == Path(bundled).resolve()
    return f"matplotlib: {BSQ_MATPLOTLIB_FAMILY} → {Path(resolved).name} ({'bundled' if ok else 'unexpected path'})"
