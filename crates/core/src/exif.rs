//! EXIF 读取与展示格式化。
//!
//! 只做「读」：相机、镜头、焦距、光圈、快门、ISO、时间、作者、版权。
//! 输出已经在 Rust 侧拼成展示字符串，保证桌面端与网页端文案一致。

use std::io::Cursor;

use exif::{Tag, Value};
use image::ImageReader;
use serde::{Deserialize, Serialize};

use crate::{EngineError, Result};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExifInfo {
    /// 已拼好的相机名（Make + Model）。
    pub camera: String,
    pub make: String,
    pub model: String,
    pub lens: String,
    pub focal: String,
    pub aperture: String,
    pub shutter: String,
    pub iso: String,
    /// 展示用日期，如 `2026.11.03 19:34`。
    pub date: String,
    /// 原始 EXIF 时间字符串。
    pub datetime: String,
    pub artist: String,
    pub copyright: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoInfo {
    pub width: u32,
    pub height: u32,
    pub exif: ExifInfo,
}

/// 读取图片尺寸与 EXIF（按 Orientation 交换宽高）。
pub fn probe(bytes: &[u8]) -> Result<PhotoInfo> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|err| EngineError::Image(err.to_string()))?;
    let (mut width, mut height) =
        reader.into_dimensions().map_err(|err| EngineError::Image(err.to_string()))?;

    let raw_exif = read_exif(bytes);
    let orientation = raw_exif.as_ref().and_then(|exif| uint(exif, Tag::Orientation)).unwrap_or(1);
    let exif = raw_exif.map(|exif| format_exif(&exif)).unwrap_or_default();

    if (5..=8).contains(&orientation) {
        std::mem::swap(&mut width, &mut height);
    }

    Ok(PhotoInfo { width, height, exif })
}

/// 读取 EXIF 方向值（1–8）。
pub fn orientation(bytes: &[u8]) -> u32 {
    read_exif(bytes).as_ref().and_then(|exif| uint(exif, Tag::Orientation)).unwrap_or(1)
}

fn read_exif(bytes: &[u8]) -> Option<exif::Exif> {
    exif::Reader::new().read_from_container(&mut Cursor::new(bytes)).ok()
}

fn field(exif: &exif::Exif, tag: Tag) -> Option<&exif::Field> {
    // 不同相机/工具会把 Exif 字段写进 IFD0 或 Exif 子 IFD。
    // Tag 常量带 Context（Tiff/Exif），同样的编号会因所在 IFD 不同而
    // 不相等，所以这里只比较 tag number。
    exif.fields().find(|field| field.tag.1 == tag.1)
}

fn ascii(exif: &exif::Exif, tag: Tag) -> String {
    let Some(field) = field(exif, tag) else {
        return String::new();
    };
    if let Value::Ascii(values) = &field.value {
        if let Some(first) = values.first() {
            return String::from_utf8_lossy(first)
                .trim_end_matches('\0')
                .trim()
                .trim_matches('"')
                .trim()
                .to_string();
        }
    }
    field.display_value().to_string().trim().to_string()
}

fn uint(exif: &exif::Exif, tag: Tag) -> Option<u32> {
    field(exif, tag).and_then(|field| field.value.get_uint(0))
}

fn rational(exif: &exif::Exif, tag: Tag) -> Option<f32> {
    let field = field(exif, tag)?;
    match &field.value {
        Value::Rational(values) => values
            .first()
            .filter(|value| value.denom != 0)
            .map(|value| value.num as f32 / value.denom as f32),
        Value::SRational(values) => values
            .first()
            .filter(|value| value.denom != 0)
            .map(|value| value.num as f32 / value.denom as f32),
        Value::Float(values) => values.first().copied(),
        Value::Double(values) => values.first().map(|value| *value as f32),
        Value::Short(values) => values.first().map(|value| *value as f32),
        Value::Long(values) => values.first().map(|value| *value as f32),
        Value::SShort(values) => values.first().map(|value| *value as f32),
        Value::SLong(values) => values.first().map(|value| *value as f32),
        _ => None,
    }
}

fn rationals(exif: &exif::Exif, tag: Tag) -> Vec<f32> {
    let Some(field) = field(exif, tag) else {
        return Vec::new();
    };
    if let Value::Rational(values) = &field.value {
        return values.iter().map(|value| value.to_f32()).collect();
    }
    Vec::new()
}

fn format_exif(exif: &exif::Exif) -> ExifInfo {
    let make = ascii(exif, Tag::Make);
    let model = ascii(exif, Tag::Model);
    let camera = camera_name(&make, &model);
    let datetime = ascii(exif, Tag::DateTimeOriginal);
    let datetime = if datetime.is_empty() { ascii(exif, Tag::DateTime) } else { datetime };

    ExifInfo {
        camera,
        make,
        model,
        lens: lens_name(exif),
        focal: rational(exif, Tag::FocalLength).map(format_focal).unwrap_or_default(),
        aperture: rational(exif, Tag::FNumber).map(format_aperture).unwrap_or_default(),
        shutter: rational(exif, Tag::ExposureTime).map(format_shutter).unwrap_or_default(),
        iso: uint(exif, Tag::PhotographicSensitivity)
            .or_else(|| uint(exif, Tag::ISOSpeed))
            .map(|iso| format!("ISO {iso}"))
            .unwrap_or_default(),
        date: format_date(&datetime),
        datetime,
        artist: ascii(exif, Tag::Artist),
        copyright: ascii(exif, Tag::Copyright),
    }
}

fn camera_name(make: &str, model: &str) -> String {
    let make = make.trim();
    let model = model.trim();
    if model.is_empty() {
        return make.to_string();
    }
    if make.is_empty() || model.to_lowercase().contains(&make.to_lowercase()) {
        return model.to_string();
    }
    format!("{make} {model}")
}

fn lens_name(exif: &exif::Exif) -> String {
    let model = ascii(exif, Tag::LensModel);
    if !model.is_empty() {
        return model;
    }
    let spec = rationals(exif, Tag::LensSpecification);
    if spec.len() >= 4 {
        let (min_focal, max_focal) = (spec[0], spec[1]);
        let aperture = spec[3];
        let focal = if (max_focal - min_focal).abs() < 0.5 {
            format!("{}mm", trim_number(min_focal))
        } else {
            format!("{}-{}mm", trim_number(min_focal), trim_number(max_focal))
        };
        return format!("{focal} F{}", trim_number(aperture));
    }
    String::new()
}

fn trim_number(value: f32) -> String {
    if (value - value.round()).abs() < 0.05 {
        format!("{:.0}", value)
    } else {
        format!("{value:.1}")
    }
}

fn format_focal(value: f32) -> String {
    format!("{}mm", trim_number(value))
}

fn format_aperture(value: f32) -> String {
    format!("f/{}", trim_number(value))
}

fn format_shutter(value: f32) -> String {
    if value <= 0.0 || !value.is_finite() {
        return String::new();
    }
    if value >= 1.0 {
        if (value - value.round()).abs() < 0.05 {
            format!("{:.0}s", value)
        } else {
            format!("{value:.1}s")
        }
    } else {
        let denominator = (1.0 / value).round().max(1.0);
        format!("1/{denominator:.0}s")
    }
}

fn format_date(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    // "2026:11:03 19:34:08" -> "2026.11.03 19:34"
    let (date, time) = raw.split_once(' ').unwrap_or((raw, ""));
    let date = date.replace(':', ".");
    if time.is_empty() {
        return date;
    }
    let short_time: Vec<&str> = time.split(':').take(2).collect();
    format!("{date} {}", short_time.join(":"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_shutter_speeds() {
        assert_eq!(format_shutter(1.0 / 250.0), "1/250s");
        assert_eq!(format_shutter(2.0), "2s");
        assert_eq!(format_shutter(0.3), "1/3s");
    }

    #[test]
    fn formats_dates() {
        assert_eq!(format_date("2026:11:03 19:34:08"), "2026.11.03 19:34");
        assert_eq!(format_date("2026:11:03"), "2026.11.03");
        assert_eq!(format_date(""), "");
    }

    #[test]
    fn joins_make_and_model() {
        assert_eq!(camera_name("SONY", "ILCE-7M4"), "SONY ILCE-7M4");
        assert_eq!(camera_name("FUJIFILM", "X-T5"), "FUJIFILM X-T5");
        assert_eq!(camera_name("", "X-T5"), "X-T5");
    }

    #[test]
    fn reads_real_camera_exif() {
        let bytes = include_bytes!("../tests/fixtures/sample.jpg");
        let photo = probe(bytes).unwrap();
        assert_eq!((photo.width, photo.height), (900, 600));
        assert!(photo.exif.camera.contains("SONY"), "camera={}", photo.exif.camera);
        assert_eq!(photo.exif.focal, "24mm");
        assert_eq!(photo.exif.aperture, "f/8");
        assert_eq!(photo.exif.shutter, "1/320s");
        assert_eq!(photo.exif.iso, "ISO 100");
        assert_eq!(photo.exif.lens, "FE 16-35mm F2.8 GM");
        assert_eq!(photo.exif.artist, "muxiner");
        assert!(photo.exif.date.starts_with("2026.10.26"));
    }
}
