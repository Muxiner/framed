//! 渲染主流程：解码 → 边框 → 文字/Logo → 编码。

use std::io::Cursor;

use base64::Engine as _;
use image::{DynamicImage, ImageEncoder, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::config::{
    parse_color, Block, FrameTemplate, LogoBlock, OutputConfig, OutputFormat, RenderConfig,
};
use crate::exif;
use crate::imageops;
use crate::layout::{geometry, Geometry};
use crate::text::{anchor_rect, draw_text_block, layout_text};
use crate::{EngineError, Result};

/// 文字/Logo 块在成品图上的像素矩形，供前端画选框与拖拽命中。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRect {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderMeta {
    pub width: u32,
    pub height: u32,
    pub blocks: Vec<BlockRect>,
}

#[derive(Debug, Clone)]
pub struct RenderOutput {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub meta: RenderMeta,
}

/// 渲染一张图。
pub fn render(image_bytes: &[u8], config: &RenderConfig) -> Result<RenderOutput> {
    let decoded =
        image::load_from_memory(image_bytes).map_err(|err| EngineError::Image(err.to_string()))?;
    let orientation = exif::orientation(image_bytes);
    let oriented = imageops::apply_orientation(decoded.to_rgba8(), orientation);

    // 预览/导出限长边：先缩放照片，再按缩放后的尺寸重算几何，
    // 这样字号、边框比例与全尺寸渲染完全一致。
    let (photo_w, photo_h) = (oriented.width(), oriented.height());
    let base_geometry = geometry(&config.frame, photo_w, photo_h);
    let max_dim = config.output.max_dim.min(20_000);
    let long_edge = base_geometry.width.max(base_geometry.height) as f32;
    let scale =
        if max_dim > 0 && long_edge > max_dim as f32 { max_dim as f32 / long_edge } else { 1.0 };
    let photo = if scale < 0.999 {
        image::imageops::resize(
            &oriented,
            ((photo_w as f32 * scale).round() as u32).max(1),
            ((photo_h as f32 * scale).round() as u32).max(1),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        oriented
    };

    let geom = geometry(&config.frame, photo.width(), photo.height());
    let background = imageops::to_rgba(parse_color(&config.frame.background));
    let mut canvas = RgbaImage::from_pixel(geom.width.max(1), geom.height.max(1), background);

    let radius = config.frame.radius.clamp(0.0, 0.25) * photo.width().min(photo.height()) as f32;
    imageops::draw_photo(&mut canvas, &photo, geom.photo_x as i32, geom.photo_y as i32, radius);

    if config.frame.template == FrameTemplate::Film && config.frame.film_holes {
        draw_film_holes(&mut canvas, &geom);
    }

    let canvas_w = canvas.width() as f32;
    let canvas_h = canvas.height() as f32;
    let mut blocks: Vec<BlockRect> = Vec::new();

    for block in &config.blocks {
        if !block.visible() {
            continue;
        }
        match block {
            Block::Text(text) => {
                if text.text.trim().is_empty() {
                    continue;
                }
                let font_size = canvas_w.min(canvas_h) * 0.018 * text.size.clamp(0.1, 8.0);
                let layout = layout_text(
                    &text.text,
                    text.font,
                    text.weight,
                    font_size,
                    text.letter_spacing,
                    text.line_height.clamp(0.5, 4.0),
                );
                if layout.is_empty() {
                    continue;
                }
                let rect = anchor_rect(
                    canvas_w,
                    canvas_h,
                    text.x,
                    text.y,
                    layout.width,
                    layout.height,
                    text.align,
                    text.align_y,
                );
                draw_text_block(
                    &mut canvas,
                    &layout,
                    rect,
                    parse_color(&text.color),
                    text.opacity,
                    text.shadow,
                );
                blocks.push(BlockRect {
                    id: text.id.clone(),
                    x: rect.x,
                    y: rect.y,
                    w: rect.w,
                    h: rect.h,
                });
            }
            Block::Logo(logo) => {
                if let Some(rect) = draw_logo(&mut canvas, logo, canvas_w, canvas_h) {
                    blocks.push(rect);
                }
            }
        }
    }

    let (bytes, mime) = encode(&canvas, &config.output)?;
    Ok(RenderOutput {
        bytes,
        mime,
        meta: RenderMeta { width: canvas.width(), height: canvas.height(), blocks },
    })
}

fn draw_logo(
    canvas: &mut RgbaImage,
    logo: &LogoBlock,
    canvas_w: f32,
    canvas_h: f32,
) -> Option<BlockRect> {
    if logo.src.trim().is_empty() || logo.width <= 0.0 {
        return None;
    }
    let bytes = decode_base64_payload(&logo.src)?;
    let image = image::load_from_memory(&bytes).ok()?.to_rgba8();
    if image.width() == 0 || image.height() == 0 {
        return None;
    }
    let target_w = (logo.width.clamp(0.01, 0.95) * canvas_w).round().max(1.0);
    let target_h = (image.height() as f32 / image.width() as f32 * target_w).round().max(1.0);
    let resized = image::imageops::resize(
        &image,
        target_w as u32,
        target_h as u32,
        image::imageops::FilterType::Lanczos3,
    );
    let rect = anchor_rect(
        canvas_w,
        canvas_h,
        logo.x,
        logo.y,
        target_w,
        target_h,
        logo.align,
        logo.align_y,
    );
    let opacity = logo.opacity.clamp(0.0, 1.0);
    for (px, py, pixel) in resized.enumerate_pixels() {
        let alpha = pixel[3] as f32 / 255.0 * opacity;
        if alpha <= 0.0 {
            continue;
        }
        imageops::blend_pixel(
            canvas,
            rect.x as i32 + px as i32,
            rect.y as i32 + py as i32,
            [pixel[0] as f32 / 255.0, pixel[1] as f32 / 255.0, pixel[2] as f32 / 255.0, alpha],
        );
    }
    Some(BlockRect { id: logo.id.clone(), x: rect.x, y: rect.y, w: rect.w, h: rect.h })
}

fn decode_base64_payload(src: &str) -> Option<Vec<u8>> {
    let payload = src.split_once(',').map(|(_, data)| data).unwrap_or(src);
    base64::engine::general_purpose::STANDARD.decode(payload.trim()).ok()
}

/// 胶片齿孔：上下边框里各一排圆角小孔。
fn draw_film_holes(canvas: &mut RgbaImage, geom: &Geometry) {
    let margin = geom.margin;
    if margin < 6.0 {
        return;
    }
    let hole_w = (margin * 0.5).max(4.0);
    let hole_h = (margin * 0.3).max(3.0);
    let gap = (hole_w * 1.5).max(8.0);
    let top_y = (margin - hole_h) / 2.0;
    let bottom_y = geom.photo_y as f32 + geom.photo_h as f32 + (geom.bottom - hole_h) / 2.0;
    let color = [1.0, 1.0, 1.0, 0.10];
    let mut x = margin * 0.35;
    let limit = geom.width as f32 - margin * 0.35 - hole_w;
    while x <= limit {
        imageops::fill_rounded_rect(canvas, x, top_y, hole_w, hole_h, hole_h / 2.0, color);
        imageops::fill_rounded_rect(canvas, x, bottom_y, hole_w, hole_h, hole_h / 2.0, color);
        x += hole_w + gap;
    }
}

fn encode(canvas: &RgbaImage, output: &OutputConfig) -> Result<(Vec<u8>, &'static str)> {
    match output.format {
        OutputFormat::Png => {
            let mut bytes = Vec::new();
            {
                let mut cursor = Cursor::new(&mut bytes);
                DynamicImage::ImageRgba8(canvas.clone())
                    .write_to(&mut cursor, ImageFormat::Png)
                    .map_err(|err| EngineError::Render(format!("PNG 编码失败: {err}")))?;
            }
            Ok((bytes, "image/png"))
        }
        OutputFormat::Jpeg => {
            let rgb = DynamicImage::ImageRgba8(canvas.clone()).to_rgb8();
            let mut bytes = Vec::new();
            let quality = output.quality.clamp(1, 100);
            {
                let mut cursor = Cursor::new(&mut bytes);
                let encoder =
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
                encoder
                    .write_image(
                        rgb.as_raw(),
                        rgb.width(),
                        rgb.height(),
                        image::ExtendedColorType::Rgb8,
                    )
                    .map_err(|err| EngineError::Render(format!("JPEG 编码失败: {err}")))?;
            }
            Ok((bytes, "image/jpeg"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AnchorY, Block, TextAlign};

    fn test_image(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x % 255) as u8, (y % 255) as u8, 120, 255])
        });
        let mut bytes = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn renders_white_frame_with_blocks() {
        let bytes = test_image(800, 600);
        let mut config = RenderConfig::default();
        config.blocks.push(Block::text("camera", "机型", "SONY ILCE-7M4").at(
            0.05,
            0.9,
            TextAlign::Left,
            AnchorY::Top,
        ));
        config.blocks.push(Block::text("watermark", "水印", "© 框影").at(
            0.95,
            0.9,
            TextAlign::Right,
            AnchorY::Top,
        ));
        let output = render(&bytes, &config).unwrap();
        assert_eq!(output.mime, "image/png");
        assert!(output.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        assert_eq!(output.meta.blocks.len(), 2);
        let margin = (0.045_f32 * 600.0).round() as u32;
        assert_eq!(output.meta.width, 800 + margin * 2);
        assert_eq!(output.meta.blocks[0].id, "camera", "block ids 应保留给前端命中");
        assert!(output.meta.blocks[0].w > 0.0);
    }

    #[test]
    fn max_dim_limits_long_edge() {
        let bytes = test_image(1200, 800);
        let mut config = RenderConfig::default();
        config.output.max_dim = 640;
        let output = render(&bytes, &config).unwrap();
        assert!(output.meta.width.max(output.meta.height) <= 640);
    }

    #[test]
    fn jpeg_output_has_correct_mime() {
        let bytes = test_image(400, 300);
        let mut config = RenderConfig::default();
        config.output.format = OutputFormat::Jpeg;
        let output = render(&bytes, &config).unwrap();
        assert_eq!(output.mime, "image/jpeg");
        assert!(output.bytes.starts_with(&[0xFF, 0xD8]));
    }
}
