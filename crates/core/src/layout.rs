//! 画布几何与默认排版。

use crate::config::{
    AnchorY, Block, FontFamily, FrameConfig, FrameTemplate, RenderConfig, TextAlign,
};
use crate::exif::PhotoInfo;

/// 由边框参数推导出的画布几何（像素）。
#[derive(Debug, Clone, Copy)]
pub struct Geometry {
    pub width: u32,
    pub height: u32,
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    /// 左/上/右边框宽度（像素）。
    pub margin: f32,
    /// 底边额外宽度（像素）。
    pub bottom: f32,
}

/// 计算成品画布与照片位置。
pub fn geometry(frame: &FrameConfig, photo_w: u32, photo_h: u32) -> Geometry {
    let photo_w = photo_w.max(1);
    let photo_h = photo_h.max(1);
    let short_edge = photo_w.min(photo_h) as f32;
    let margin = (frame.margin.clamp(0.0, 0.3) * short_edge).round();
    let bottom = (margin * frame.bottom_ratio.clamp(0.0, 10.0)).round();
    Geometry {
        width: photo_w + (margin * 2.0) as u32,
        height: photo_h + margin as u32 + bottom as u32,
        photo_x: margin as u32,
        photo_y: margin as u32,
        photo_w,
        photo_h,
        margin,
        bottom,
    }
}

/// 基于 EXIF 与模板生成一份「开箱即用」的排版。
///
/// 12 栅格的落点都换算成归一化坐标：文字默认贴着底边/角部排布，
/// 编辑器里可拖动再吸附到 1/12 格线。
pub fn default_config(photo: &PhotoInfo, template: FrameTemplate) -> RenderConfig {
    let frame = FrameConfig::for_template(template);
    let geom = geometry(&frame, photo.width, photo.height);
    let canvas_w = geom.width.max(1) as f32;
    let canvas_h = geom.height.max(1) as f32;
    let margin = geom.margin;
    let bottom = geom.bottom;
    let photo_bottom = margin + geom.photo_h as f32;
    let base = canvas_w.min(canvas_h) * 0.018;

    let exif = &photo.exif;
    let camera_line = if exif.camera.is_empty() {
        "相机型号".to_string()
    } else if exif.lens.is_empty() {
        exif.camera.clone()
    } else {
        format!("{} · {}", exif.camera, exif.lens)
    };
    let gear_parts: Vec<&str> =
        [exif.focal.as_str(), exif.aperture.as_str(), exif.shutter.as_str(), exif.iso.as_str()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect();
    let gear_line =
        if gear_parts.is_empty() { "拍摄参数".to_string() } else { gear_parts.join(" · ") };
    let date_line = exif.date.clone();
    let watermark_text = if !exif.copyright.is_empty() {
        exif.copyright.clone()
    } else if !exif.artist.is_empty() {
        format!("© {}", exif.artist)
    } else {
        "© Your Name".to_string()
    };

    let (fg, muted) =
        if template.is_dark() { ("#f4f0e8", "#b7b0a3") } else { ("#1b1a17", "#6f685c") };

    let nx = |px: f32| (px / canvas_w).clamp(0.0, 1.0);
    let ny = |py: f32| (py / canvas_h).clamp(0.0, 1.0);

    let mut blocks: Vec<Block> = Vec::new();

    match template {
        FrameTemplate::White => {
            let left = margin + base * 0.35;
            let right = canvas_w - margin - base * 0.35;
            let camera_y = photo_bottom + bottom * 0.14;
            blocks.push(
                Block::text("camera", "机型", &camera_line)
                    .at(nx(left), ny(camera_y), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Sans, 600, 1.0, fg),
            );
            blocks.push(
                Block::text("gear", "拍摄参数", &gear_line)
                    .at(nx(left), ny(camera_y + base * 1.62), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.82, muted),
            );
            blocks.push(
                Block::text("date", "日期", &date_line)
                    .at(nx(right), ny(camera_y), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.72, muted),
            );
            blocks.push(
                Block::text("watermark", "水印", &watermark_text)
                    .at(nx(right), ny(camera_y + base * 1.62), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Sans, 400, 0.78, fg),
            );
        }
        FrameTemplate::Polaroid => {
            let right = canvas_w - margin - base * 0.4;
            let camera_y = photo_bottom + bottom * 0.18;
            blocks.push(
                Block::text("camera", "机型", &camera_line)
                    .at(0.5, ny(camera_y), TextAlign::Center, AnchorY::Top)
                    .style(FontFamily::Sans, 600, 1.0, fg),
            );
            blocks.push(
                Block::text("gear", "拍摄参数", &gear_line)
                    .at(0.5, ny(camera_y + base * 1.7), TextAlign::Center, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.8, muted),
            );
            blocks.push(
                Block::text("watermark", "水印", &watermark_text)
                    .at(nx(right), ny(photo_bottom + bottom * 0.60), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Sans, 400, 0.74, fg),
            );
            blocks.push(
                Block::text("date", "日期", &date_line)
                    .at(nx(right), ny(photo_bottom + bottom * 0.82), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.68, muted),
            );
        }
        FrameTemplate::Film => {
            let left = margin + geom.photo_w as f32 * 0.032;
            let right = canvas_w - margin - geom.photo_w as f32 * 0.032;
            let camera_y = photo_bottom - base * 3.0;
            blocks.push(
                Block::text("camera", "机型", &camera_line)
                    .at(nx(left), ny(camera_y), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Mono, 600, 0.8, fg)
                    .shadow(true),
            );
            blocks.push(
                Block::text("gear", "拍摄参数", &gear_line)
                    .at(nx(left), ny(camera_y + base * 1.5), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.76, muted)
                    .shadow(true),
            );
            blocks.push(
                Block::text("date", "日期", &date_line)
                    .at(nx(right), ny(camera_y), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.7, muted)
                    .shadow(true),
            );
            blocks.push(
                Block::text("watermark", "水印", &watermark_text)
                    .at(nx(right), ny(camera_y + base * 1.5), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.74, fg)
                    .shadow(true),
            );
        }
        FrameTemplate::Black | FrameTemplate::None => {
            let (left, right) = if template == FrameTemplate::None {
                (canvas_w * 0.032, canvas_w * 0.968)
            } else {
                (
                    margin + geom.photo_w as f32 * 0.028,
                    canvas_w - margin - geom.photo_w as f32 * 0.028,
                )
            };
            let camera_y = if template == FrameTemplate::None {
                canvas_h - base * 3.1
            } else {
                photo_bottom - base * 3.1
            };
            blocks.push(
                Block::text("camera", "机型", &camera_line)
                    .at(nx(left), ny(camera_y), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Sans, 600, 0.92, fg)
                    .shadow(true),
            );
            blocks.push(
                Block::text("gear", "拍摄参数", &gear_line)
                    .at(nx(left), ny(camera_y + base * 1.55), TextAlign::Left, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.78, muted)
                    .shadow(true),
            );
            blocks.push(
                Block::text("date", "日期", &date_line)
                    .at(nx(right), ny(camera_y), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Mono, 400, 0.7, muted)
                    .shadow(true),
            );
            blocks.push(
                Block::text("watermark", "水印", &watermark_text)
                    .at(nx(right), ny(camera_y + base * 1.55), TextAlign::Right, AnchorY::Top)
                    .style(FontFamily::Sans, 400, 0.76, fg)
                    .shadow(true),
            );
        }
    }

    RenderConfig { version: 1, frame, blocks, ..RenderConfig::default() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exif::{ExifInfo, PhotoInfo};

    fn photo(width: u32, height: u32) -> PhotoInfo {
        PhotoInfo {
            width,
            height,
            exif: ExifInfo {
                camera: "SONY ILCE-7M4".into(),
                lens: "FE 24-70mm F2.8 GM II".into(),
                focal: "35mm".into(),
                aperture: "f/2.8".into(),
                shutter: "1/250s".into(),
                iso: "ISO 100".into(),
                date: "2026.11.03 19:34".into(),
                ..ExifInfo::default()
            },
        }
    }

    #[test]
    fn white_frame_adds_bottom_band() {
        let geom = geometry(&FrameConfig::for_template(FrameTemplate::White), 1600, 1067);
        assert_eq!(geom.width, 1600 + geom.margin as u32 * 2);
        assert!(geom.bottom > geom.margin);
    }

    #[test]
    fn default_config_places_four_blocks() {
        let config = default_config(&photo(1600, 1067), FrameTemplate::White);
        assert_eq!(config.blocks.len(), 4);
        let ids: Vec<&str> = config.blocks.iter().map(|b| b.id()).collect();
        assert_eq!(ids, vec!["camera", "gear", "date", "watermark"]);
        for block in &config.blocks {
            let (x, y) = block.position();
            assert!((0.0..=1.0).contains(&x));
            assert!((0.0..=1.0).contains(&y));
        }
    }

    #[test]
    fn none_template_keeps_photo_size() {
        let geom = geometry(&FrameConfig::for_template(FrameTemplate::None), 800, 600);
        assert_eq!((geom.width, geom.height), (800, 600));
    }
}
