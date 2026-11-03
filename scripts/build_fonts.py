#!/usr/bin/env python3
"""Download the upstream Google Fonts we need and subset them for Framed.

The renderer rasterises glyphs with `ab_glyph`, which only understands
TrueType/OpenType fonts (not woff2).  Google Fonts' CSS API is flaky on some
networks, so we pull the TTF files from the jsDelivr mirror of the
`@expo-google-fonts/*` packages and subset them with fontTools to keep the
wasm bundle small.

Run:
    PYTHONPATH=<fonttools> python3 scripts/build_fonts.py
"""

from __future__ import annotations

import io
import os
import subprocess

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "crates", "core", "assets", "fonts")

UA = "Mozilla/4.0"
MIRROR = "https://cdn.jsdelivr.net/npm"

# (output file, url, uses_cjk_charset)
FONTS = [
    (
        "Inter-Regular.ttf",
        f"{MIRROR}/@expo-google-fonts/inter/Inter_400Regular.ttf",
        False,
    ),
    (
        "Inter-SemiBold.ttf",
        f"{MIRROR}/@expo-google-fonts/inter/Inter_600SemiBold.ttf",
        False,
    ),
    (
        "JetBrainsMono-Regular.ttf",
        f"{MIRROR}/@expo-google-fonts/jetbrains-mono/JetBrainsMono_400Regular.ttf",
        False,
    ),
    (
        "JetBrainsMono-SemiBold.ttf",
        f"{MIRROR}/@expo-google-fonts/jetbrains-mono/JetBrainsMono_600SemiBold.ttf",
        False,
    ),
    (
        "NotoSansSC-Regular.ttf",
        f"{MIRROR}/@expo-google-fonts/noto-sans-sc/NotoSansSC_400Regular.ttf",
        True,
    ),
    (
        "NotoSansSC-Bold.ttf",
        f"{MIRROR}/@expo-google-fonts/noto-sans-sc/NotoSansSC_700Bold.ttf",
        True,
    ),
]

LICENSES = [
    ("OFL-Inter.txt", "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/OFL.txt"),
    (
        "OFL-JetBrainsMono.txt",
        "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/jetbrainsmono/OFL.txt",
    ),
    ("OFL-NotoSansSC.txt", f"{MIRROR}/@expo-google-fonts/noto-sans-sc/OFL.txt"),
]

LATIN = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 supplement (© ® ° × µ ...)
    (0x2000, 0x206F),  # General punctuation (– — ‘ ’ “ ” … · ″)
    (0x20A0, 0x20BF),  # Currency
    (0x2100, 0x214F),  # Letterlike (™ Ω №)
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Math (≈ ≤ ≥ −)
]


def latin_codepoints() -> set[int]:
    cps: set[int] = set()
    for lo, hi in LATIN:
        cps.update(range(lo, hi + 1))
    return cps


def gb2312_codepoints() -> set[int]:
    """Every character encodable in GB2312 (the 6763 most common hanzi)."""
    cps: set[int] = set()
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                ch = bytes((hi, lo)).decode("gb2312")
            except UnicodeDecodeError:
                continue
            cps.add(ord(ch))
    # CJK punctuation + fullwidth forms used in Chinese copy.
    cps.update(range(0x3000, 0x303F))
    cps.update(range(0xFF00, 0xFFEF))
    return cps


def fetch(url: str) -> bytes:
    """curl is noticeably more reliable than urllib on restricted networks."""
    result = subprocess.run(
        ["curl", "-sSfL", "--max-time", "180", "-A", UA, url],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"download failed: {url}: {result.stderr.decode(errors='replace')}"
        )
    return result.stdout


def subset_font(raw: bytes, codepoints: set[int], out_path: str) -> None:
    font = TTFont(io.BytesIO(raw))
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["DSIG"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(codepoints))
    subsetter.subset(font)
    font.save(out_path)
    font.close()


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    latin = latin_codepoints()
    cjk = gb2312_codepoints() | latin
    print(f"latin codepoints: {len(latin)}, cjk codepoints: {len(cjk)}")

    for filename, url, uses_cjk in FONTS:
        out_path = os.path.join(OUT_DIR, filename)
        print(f"subset {filename}")
        subset_font(fetch(url), cjk if uses_cjk else latin, out_path)
        print(f"  {os.path.getsize(out_path) / 1024:.1f} KiB")

    for filename, url in LICENSES:
        try:
            with open(os.path.join(OUT_DIR, filename), "wb") as fh:
                fh.write(fetch(url))
        except RuntimeError as exc:  # licence files are nice-to-have
            print(f"  skip {filename}: {exc}")

    total = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print(f"total: {total / 1024 / 1024:.2f} MiB")


if __name__ == "__main__":
    main()
