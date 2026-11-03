#!/usr/bin/env python3
"""生成示例照片（带 EXIF）与 core crate 的测试夹具。

用纯 Pillow + numpy 合成三张有「照片感」的图：
- mountain.jpg  晨光山脊（SONY）
- city.jpg      黄昏天际线（FUJIFILM）
- portrait.jpg  暗调人像剪影（Canon）

真实拍摄的照片版权归各自作者，这里只用于演示 EXIF 排版，全部合成。

Run:
    python3 scripts/make_samples.py
"""

from __future__ import annotations

import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, TiffImagePlugin

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "apps", "web", "public", "samples")
FIXTURE_DIR = os.path.join(ROOT, "crates", "core", "tests", "fixtures")

WIDTH, HEIGHT = 1800, 1200


def gradient(top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    top_color = np.array(top, dtype=np.float32)
    bottom_color = np.array(bottom, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, HEIGHT, dtype=np.float32)[:, None, None]
    pixels = top_color[None, None, :] * (1 - ramp) + bottom_color[None, None, :] * ramp
    pixels = np.repeat(pixels, WIDTH, axis=1)
    return Image.fromarray(pixels.clip(0, 255).astype(np.uint8), mode="RGB")


def add_noise(image: Image.Image, amount: float = 5.0) -> Image.Image:
    pixels = np.array(image, dtype=np.float32)
    noise = np.random.normal(0.0, amount, pixels.shape[:2])[:, :, None]
    return Image.fromarray((pixels + noise).clip(0, 255).astype(np.uint8), mode="RGB")


def vignette(image: Image.Image, strength: float = 0.35) -> Image.Image:
    width, height = image.size
    x = np.linspace(-1.0, 1.0, width, dtype=np.float32)[None, :]
    y = np.linspace(-1.0, 1.0, height, dtype=np.float32)[:, None]
    mask = 1.0 - strength * np.clip((x * x + y * y) / 2.0, 0.0, 1.0) ** 1.4
    pixels = np.array(image, dtype=np.float32) * mask[:, :, None]
    return Image.fromarray(pixels.clip(0, 255).astype(np.uint8), mode="RGB")


def mountain() -> Image.Image:
    sky = gradient((242, 197, 142), (108, 143, 180))
    draw = ImageDraw.Draw(sky, "RGBA")
    # 太阳与光晕
    sun = Image.new("RGBA", sky.size, (0, 0, 0, 0))
    glow = ImageDraw.Draw(sun)
    glow.ellipse((1180, 320, 1600, 740), fill=(255, 236, 190, 90))
    sun = sun.filter(ImageFilter.GaussianBlur(70))
    glow = ImageDraw.Draw(sun)
    glow.ellipse((1310, 430, 1450, 570), fill=(255, 244, 214, 235))
    sky = Image.alpha_composite(sky.convert("RGBA"), sun).convert("RGB")
    draw = ImageDraw.Draw(sky, "RGBA")
    # 三层山脊，越远越淡
    layers = [
        ((92, 108, 118, 150), 640, 0.9),
        ((58, 70, 82, 210), 760, 0.7),
        ((30, 38, 46, 255), 920, 0.45),
    ]
    for color, base_y, roughness in layers:
        points = [(0, HEIGHT), (0, base_y)]
        for x in range(0, WIDTH + 80, 80):
            wave = int(
                120 * np.sin(x / 340.0 + roughness) + 60 * np.sin(x / 90.0 + base_y)
            )
            points.append((x, base_y + wave * roughness))
        points.append((WIDTH, HEIGHT))
        draw.polygon(points, fill=color)
    # 晨雾
    haze = Image.new("RGBA", sky.size, (0, 0, 0, 0))
    haze_draw = ImageDraw.Draw(haze)
    haze_draw.rectangle((0, 700, WIDTH, HEIGHT), fill=(206, 214, 220, 42))
    haze = haze.filter(ImageFilter.GaussianBlur(40))
    sky = Image.alpha_composite(sky.convert("RGBA"), haze).convert("RGB")
    return vignette(add_noise(sky, 4.0), 0.28)


def city() -> Image.Image:
    sky = gradient((38, 42, 62), (238, 160, 92))
    draw = ImageDraw.Draw(sky, "RGBA")
    # 远处的楼群
    random.seed(7)
    for layer, (alpha, base) in enumerate(((140, 880), (255, 980))):
        x = -40
        while x < WIDTH:
            w = random.randint(70, 180)
            h = random.randint(120, 420) if layer else random.randint(60, 220)
            color = (26, 28, 38, alpha) if layer else (44, 47, 60, alpha)
            draw.rectangle((x, base - h, x + w, HEIGHT), fill=color)
            if layer:
                for wx in range(x + 14, x + w - 10, 26):
                    for wy in range(base - h + 18, HEIGHT, 34):
                        if random.random() < 0.45:
                            draw.rectangle(
                                (wx, wy, wx + 9, wy + 12),
                                fill=(255, 196, 120, 200),
                            )
            x += w + random.randint(6, 26)
    # 水面倒影
    reflection = sky.transpose(Image.FLIP_TOP_BOTTOM).crop((0, HEIGHT - 260, WIDTH, HEIGHT))
    reflection = reflection.filter(ImageFilter.GaussianBlur(9))
    sky.paste(reflection, (0, HEIGHT - 130))
    sky = sky.filter(ImageFilter.GaussianBlur(0.4))
    return vignette(add_noise(sky, 5.0), 0.3)


def portrait() -> Image.Image:
    backdrop = gradient((58, 48, 44), (22, 19, 18))
    glow = Image.new("RGBA", backdrop.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((420, -260, 1500, 760), fill=(214, 148, 96, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    backdrop = Image.alpha_composite(backdrop.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(backdrop, "RGBA")
    # 头肩剪影
    draw.ellipse((760, 300, 1090, 700), fill=(16, 14, 14, 255))
    draw.rounded_rectangle(
        (560, 700, 1300, HEIGHT + 140), radius=190, fill=(16, 14, 14, 255)
    )
    # 轮廓光
    rim = Image.new("RGBA", backdrop.size, (0, 0, 0, 0))
    rim_draw = ImageDraw.Draw(rim)
    rim_draw.arc((748, 288, 1102, 712), start=200, end=340, fill=(245, 190, 130, 170), width=16)
    rim_draw.arc((548, 688, 1312, HEIGHT + 152), start=200, end=340, fill=(245, 190, 130, 90), width=22)
    rim = rim.filter(ImageFilter.GaussianBlur(9))
    backdrop = Image.alpha_composite(backdrop.convert("RGBA"), rim).convert("RGB")
    return vignette(add_noise(backdrop, 4.5), 0.42)


def write_exif(path: str, image: Image.Image, exif_values: dict) -> None:
    exif = Image.Exif()
    for tag, value in exif_values.items():
        exif[tag] = value
    image.save(path, quality=92, subsampling=1, exif=exif, optimize=True)


def main() -> None:
    random.seed(20261103)
    np.random.seed(20261103)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(FIXTURE_DIR, exist_ok=True)

    specs = {
        "mountain.jpg": (
            mountain(),
            {
                0x010F: "SONY",
                0x0110: "ILCE-7M4",
                0x0112: 1,
                0x0131: "Framed Sample Generator",
                0x013B: "muxiner",
                0x829A: TiffImagePlugin.IFDRational(1, 320),
                0x829D: TiffImagePlugin.IFDRational(80, 10),
                0x8827: 100,
                0x9003: "2026:10:26 07:12:40",
                0x920A: TiffImagePlugin.IFDRational(24, 1),
                0xA434: "FE 16-35mm F2.8 GM",
            },
        ),
        "city.jpg": (
            city(),
            {
                0x010F: "FUJIFILM",
                0x0110: "X-T5",
                0x0112: 1,
                0x0131: "Framed Sample Generator",
                0x013B: "muxiner",
                0x829A: TiffImagePlugin.IFDRational(1, 125),
                0x829D: TiffImagePlugin.IFDRational(28, 10),
                0x8827: 400,
                0x9003: "2026:11:01 18:47:12",
                0x920A: TiffImagePlugin.IFDRational(35, 1),
                0xA434: "XF 35mm F1.4 R",
            },
        ),
        "portrait.jpg": (
            portrait(),
            {
                0x010F: "Canon",
                0x0110: "EOS R5",
                0x0112: 1,
                0x0131: "Framed Sample Generator",
                0x013B: "muxiner",
                0x829A: TiffImagePlugin.IFDRational(1, 200),
                0x829D: TiffImagePlugin.IFDRational(16, 10),
                0x8827: 200,
                0x9003: "2026:09:18 15:03:26",
                0x920A: TiffImagePlugin.IFDRational(85, 1),
                0xA434: "RF 85mm F1.2 L USM",
            },
        ),
    }

    for filename, (image, exif) in specs.items():
        path = os.path.join(OUT_DIR, filename)
        write_exif(path, image, exif)
        print(f"{path}  {os.path.getsize(path) / 1024:.0f} KiB")

    # core crate 测试夹具：缩小一版，保留 EXIF。
    fixture = os.path.join(FIXTURE_DIR, "sample.jpg")
    mountain_image = specs["mountain.jpg"][0]
    write_exif(
        fixture,
        mountain_image.resize((900, 600), Image.LANCZOS),
        specs["mountain.jpg"][1],
    )
    print(f"{fixture}  {os.path.getsize(fixture) / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
