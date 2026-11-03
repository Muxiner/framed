#!/usr/bin/env python3
"""生成「框影 Framed」应用图标源图（1024×1024 PNG）。

风格：深炭底 + 暖金取景框（四角括号 + 中心对焦点），克制、专业影像工具气质。
用法（Pillow）：
    python3 make_icon.py [输出路径]

随后用 Tauri CLI 生成全套尺寸：
    npm --prefix apps/desktop run icon
（等价于 `tauri icon icons/source.png`，产物写入 src-tauri/icons/）
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024          # 最终尺寸
SS = 4               # 超采样倍数（4K 绘制后缩小，边缘平滑）
S = SIZE * SS

BG_TOP = (34, 31, 27)        # #221f1b 略亮于面板，避免死黑
BG_BOTTOM = (14, 13, 11)     # #0e0d0b
GOLD = (229, 181, 103)       # #e5b567
GOLD_DIM = (122, 96, 55)     # #7a6037 内描边
BORDER = (42, 39, 35)        # #2a2723


def build() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # --- 圆角方形底板 + 竖向渐变 -------------------------------------------
    inset = 100 * SS
    radius = 190 * SS
    plate = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    plate_draw = ImageDraw.Draw(plate)
    plate_draw.rounded_rectangle(
        [(inset, inset), (S - inset, S - inset)],
        radius=radius,
        fill=(255, 255, 255, 255),
    )

    gradient = Image.new("RGBA", (S, S))
    grad_draw = ImageDraw.Draw(gradient)
    for y in range(S):
        t = y / (S - 1)
        color = tuple(
            round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
        grad_draw.line([(0, y), (S, y)], fill=color + (255,))
    img.paste(gradient, (0, 0), plate)

    draw = ImageDraw.Draw(img)

    # 内描边：让底板与透明背景之间有一道极细的界线
    draw.rounded_rectangle(
        [(inset, inset), (S - inset, S - inset)],
        radius=radius,
        outline=BORDER + (255,),
        width=6 * SS,
    )

    # --- 暖金「取景框」四角括号 -------------------------------------------
    frame_inset = 300 * SS
    arm = 148 * SS
    stroke = 38 * SS
    left, top = frame_inset, frame_inset
    right, bottom = S - frame_inset, S - frame_inset
    cap = stroke / 2

    def rounded_line(start, end):
        draw.line([start, end], fill=GOLD + (255,), width=stroke)
        for x, y in (start, end):
            draw.ellipse(
                [(x - cap, y - cap), (x + cap, y + cap)], fill=GOLD + (255,)
            )

    # 左上
    rounded_line((left, top), (left + arm, top))
    rounded_line((left, top), (left, top + arm))
    # 右上
    rounded_line((right, top), (right - arm, top))
    rounded_line((right, top), (right, top + arm))
    # 左下
    rounded_line((left, bottom), (left + arm, bottom))
    rounded_line((left, bottom), (left, bottom - arm))
    # 右下
    rounded_line((right, bottom), (right - arm, bottom))
    rounded_line((right, bottom), (right, bottom - arm))

    # --- 中心对焦环 ---------------------------------------------------------
    cx = cy = S // 2
    ring_r = 96 * SS
    ring_w = 24 * SS
    draw.ellipse(
        [(cx - ring_r, cy - ring_r), (cx + ring_r, cy + ring_r)],
        outline=GOLD + (255,),
        width=ring_w,
    )
    dot_r = 12 * SS
    draw.ellipse(
        [(cx - dot_r, cy - dot_r), (cx + dot_r, cy + dot_r)], fill=GOLD + (255,)
    )

    # 对焦环与括号之间四个细小金色定位刻度（极克制）
    tick = 18 * SS
    tick_w = 8 * SS
    gap = ring_r + 46 * SS
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x0, y0 = cx + sx * gap, cy + sy * gap
        x1, y1 = cx + sx * (gap + tick), cy + sy * (gap + tick)
        rounded_line_tick(draw, (x0, y0), (x1, y1), tick_w)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def rounded_line_tick(draw: ImageDraw.ImageDraw, start, end, width):
    draw.line([start, end], fill=GOLD_DIM + (255,), width=width)
    cap = width / 2
    for x, y in (start, end):
        draw.ellipse([(x - cap, y - cap), (x + cap, y + cap)], fill=GOLD_DIM + (255,))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("source.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    build().save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
