//! 文字排版与光栅化。
//!
//! 只做「逐字水平排版 + 抗锯齿覆盖」，覆盖中英混排、字间距、行高、
//! 水平/垂直锚定、投影。复杂 shaping（阿拉伯语/印地语）不在范围内。

use ab_glyph::{point, Font, PxScale, ScaleFont};

use crate::config::{AnchorY, FontFamily, TextAlign};
use crate::fonts::{fonts, Face};
use crate::imageops::blend_pixel;
use image::RgbaImage;

#[derive(Debug, Clone)]
struct PlacedGlyph {
    face: Face,
    ch: char,
    /// 行内水平位置（像素）。
    x: f32,
}

#[derive(Debug, Clone)]
struct Line {
    glyphs: Vec<PlacedGlyph>,
    ascent: f32,
}

/// 排版结果（像素单位，原点在文字块左上角）。
#[derive(Debug, Clone)]
pub struct TextLayout {
    lines: Vec<Line>,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    line_height: f32,
}

impl TextLayout {
    pub fn is_empty(&self) -> bool {
        self.lines.iter().all(|line| line.glyphs.is_empty())
    }
}

/// 逐字排版。`letter_spacing` 以 em 为单位；`line_height` 为字号的倍数。
pub fn layout_text(
    text: &str,
    family: FontFamily,
    weight: u16,
    font_size: f32,
    letter_spacing: f32,
    line_height: f32,
) -> TextLayout {
    let font_set = fonts();
    let scale = PxScale::from(font_size.max(1.0));
    let spacing = letter_spacing * font_size;

    let mut lines = Vec::new();
    let mut width: f32 = 0.0;

    for raw_line in text.split('\n') {
        let mut glyphs = Vec::new();
        let mut pen_x = 0.0_f32;
        let mut ascent = 0.0_f32;
        let mut has_glyph = false;

        for ch in raw_line.chars() {
            if ch == '\r' {
                continue;
            }
            let face = font_set.face_for(family, weight, ch);
            let font = font_set.get(face);
            let scaled = font.as_scaled(scale);
            if !has_glyph {
                ascent = scaled.ascent();
                has_glyph = true;
            }
            let id = font.glyph_id(ch);
            let advance = scaled.h_advance(id) + spacing;
            glyphs.push(PlacedGlyph { face, ch, x: pen_x });
            pen_x += advance;
        }

        let line_width = if glyphs.is_empty() { 0.0 } else { (pen_x - spacing).max(0.0) };
        width = width.max(line_width);
        lines.push(Line { glyphs, ascent });
    }

    let height = (lines.len() as f32) * font_size * line_height;
    TextLayout { lines, width, height, font_size, line_height }
}

/// 文字块在画布上的矩形。
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// 根据归一化锚点与对齐方式，计算文字块左上角。
#[allow(clippy::too_many_arguments)]
pub fn anchor_rect(
    canvas_w: f32,
    canvas_h: f32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    align: TextAlign,
    align_y: AnchorY,
) -> Rect {
    let left = match align {
        TextAlign::Left => x * canvas_w,
        TextAlign::Center => x * canvas_w - width / 2.0,
        TextAlign::Right => x * canvas_w - width,
    };
    let top = match align_y {
        AnchorY::Top => y * canvas_h,
        AnchorY::Middle => y * canvas_h - height / 2.0,
        AnchorY::Bottom => y * canvas_h - height,
    };
    Rect { x: left, y: top, w: width, h: height }
}

/// 把文字块画到画布上（含可选投影）。
#[allow(clippy::too_many_arguments)]
pub fn draw_text_block(
    canvas: &mut RgbaImage,
    layout: &TextLayout,
    rect: Rect,
    color: [f32; 4],
    opacity: f32,
    shadow: bool,
) {
    if layout.is_empty() {
        return;
    }
    let opacity = opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 {
        return;
    }

    // 预留 padding，容纳负 bearing / 投影。
    let pad = (layout.font_size * 0.6).ceil().max(4.0);
    let mask_w = (layout.width + pad * 2.0).ceil().max(1.0) as usize;
    let mask_h = (layout.height + pad * 2.0).ceil().max(1.0) as usize;
    let mut mask = vec![0.0_f32; mask_w * mask_h];

    let font_set = fonts();
    let scale = PxScale::from(layout.font_size.max(1.0));
    let mut line_top = 0.0_f32;

    for line in &layout.lines {
        let baseline = line_top + line.ascent + pad;
        for glyph in &line.glyphs {
            if glyph.ch.is_whitespace() {
                continue;
            }
            let font = font_set.get(glyph.face);
            let positioned = font
                .glyph_id(glyph.ch)
                .with_scale_and_position(scale, point(glyph.x + pad, baseline));
            let Some(outlined) = font.outline_glyph(positioned) else {
                continue;
            };
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px < 0 || py < 0 || px >= mask_w as i32 || py >= mask_h as i32 {
                    return;
                }
                let index = py as usize * mask_w + px as usize;
                mask[index] = (mask[index] + coverage).min(1.0);
            });
        }
        line_top += layout.font_size * layout.line_height;
    }

    let origin_x = rect.x.round() as i32 - pad as i32;
    let origin_y = rect.y.round() as i32 - pad as i32;

    if shadow {
        let radius = (layout.font_size * 0.09).clamp(1.0, 24.0);
        let blurred = box_blur(&mask, mask_w, mask_h, radius);
        let offset_x = (layout.font_size * 0.05).round() as i32;
        let offset_y = (layout.font_size * 0.08).round() as i32;
        let shadow_alpha = 0.42 * opacity;
        composite_mask(
            canvas,
            &blurred,
            mask_w,
            mask_h,
            origin_x + offset_x,
            origin_y + offset_y,
            [0.0, 0.0, 0.0, opacity.min(1.0)],
            shadow_alpha,
        );
    }

    composite_mask(canvas, &mask, mask_w, mask_h, origin_x, origin_y, color, opacity);
}

#[allow(clippy::too_many_arguments)]
fn composite_mask(
    canvas: &mut RgbaImage,
    mask: &[f32],
    mask_w: usize,
    mask_h: usize,
    origin_x: i32,
    origin_y: i32,
    color: [f32; 4],
    opacity: f32,
) {
    let canvas_w = canvas.width() as i32;
    let canvas_h = canvas.height() as i32;
    for y in 0..mask_h {
        for x in 0..mask_w {
            let coverage = mask[y * mask_w + x];
            if coverage <= 0.001 {
                continue;
            }
            let px = origin_x + x as i32;
            let py = origin_y + y as i32;
            if px < 0 || py < 0 || px >= canvas_w || py >= canvas_h {
                continue;
            }
            let alpha = color[3] * opacity * coverage.clamp(0.0, 1.0);
            blend_pixel(canvas, px, py, [color[0], color[1], color[2], alpha]);
        }
    }
}

/// 可分离盒式模糊（两趟），用于柔和投影。
fn box_blur(mask: &[f32], width: usize, height: usize, radius: f32) -> Vec<f32> {
    let radius = radius.round().max(1.0) as usize;
    let mut horizontal = vec![0.0_f32; mask.len()];
    let mut output = vec![0.0_f32; mask.len()];
    let window = (radius * 2 + 1) as f32;

    for y in 0..height {
        let row = y * width;
        let mut sum: f32 = (0..=radius.min(width - 1)).map(|x| mask[row + x]).sum();
        for x in 0..width {
            horizontal[row + x] = sum / window;
            let add = x + radius + 1;
            let sub = x as isize - radius as isize;
            if add < width {
                sum += mask[row + add];
            }
            if sub >= 0 {
                sum -= mask[row + sub as usize];
            }
        }
    }

    for x in 0..width {
        let mut sum: f32 = (0..=radius.min(height - 1)).map(|y| horizontal[y * width + x]).sum();
        for y in 0..height {
            output[y * width + x] = sum / window;
            let add = y + radius + 1;
            let sub = y as isize - radius as isize;
            if add < height {
                sum += horizontal[add * width + x];
            }
            if sub >= 0 {
                sum -= horizontal[sub as usize * width + x];
            }
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_multiline_text() {
        let layout =
            layout_text("SONY α7 IV\n35mm · f/2.8", FontFamily::Mono, 400, 24.0, 0.0, 1.35);
        assert!(layout.width > 0.0);
        assert!((layout.height - 24.0 * 1.35 * 2.0).abs() < 0.01);
    }

    #[test]
    fn centers_anchor() {
        let rect =
            anchor_rect(1000.0, 500.0, 0.5, 0.5, 200.0, 40.0, TextAlign::Center, AnchorY::Middle);
        assert!((rect.x - 400.0).abs() < 0.01);
        assert!((rect.y - 230.0).abs() < 0.01);
    }

    #[test]
    fn renders_glyph_coverage() {
        let layout = layout_text("A", FontFamily::Sans, 400, 64.0, 0.0, 1.2);
        let mut canvas = RgbaImage::new(200, 100);
        draw_text_block(
            &mut canvas,
            &layout,
            Rect { x: 20.0, y: 10.0, w: layout.width, h: layout.height },
            [0.0, 0.0, 0.0, 1.0],
            1.0,
            false,
        );
        let covered = canvas.pixels().filter(|pixel| pixel[3] > 0).count();
        assert!(covered > 50, "文字应当画出可见像素，实际 {covered}");
    }
}
