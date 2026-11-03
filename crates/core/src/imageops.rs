//! 图像合成小工具：alpha 混合、EXIF 转正、圆角照片、圆角矩形。

use image::{imageops, Rgba, RgbaImage};

/// 把浮点 RGBA（0–1）按 source-over 混合到画布像素。
pub fn blend_pixel(canvas: &mut RgbaImage, x: i32, y: i32, src: [f32; 4]) {
    let (width, height) = (canvas.width() as i32, canvas.height() as i32);
    if x < 0 || y < 0 || x >= width || y >= height {
        return;
    }
    let src_a = src[3].clamp(0.0, 1.0);
    if src_a <= 0.0 {
        return;
    }
    let pixel = canvas.get_pixel_mut(x as u32, y as u32);
    let dst_a = pixel[3] as f32 / 255.0;
    let out_a = src_a + dst_a * (1.0 - src_a);
    if out_a <= 0.0 {
        return;
    }
    for channel in 0..3 {
        let dst = pixel[channel] as f32 / 255.0;
        let out = (src[channel] * src_a + dst * dst_a * (1.0 - src_a)) / out_a;
        pixel[channel] = (out * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    pixel[3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
}

/// 按 EXIF Orientation（1–8）把照片转正。
pub fn apply_orientation(image: RgbaImage, orientation: u32) -> RgbaImage {
    match orientation {
        2 => imageops::flip_horizontal(&image),
        3 => imageops::rotate180(&image),
        4 => imageops::flip_vertical(&image),
        5 => imageops::rotate90(&imageops::flip_horizontal(&image)),
        6 => imageops::rotate90(&image),
        7 => imageops::rotate270(&imageops::flip_horizontal(&image)),
        8 => imageops::rotate270(&image),
        _ => image,
    }
}

/// 圆角矩形覆盖率（SDF 抗锯齿）。
fn rounded_coverage(px: f32, py: f32, width: f32, height: f32, radius: f32) -> f32 {
    let half_w = width / 2.0;
    let half_h = height / 2.0;
    let r = radius.min(half_w).min(half_h).max(0.0);
    let qx = (px - half_w).abs() - (half_w - r);
    let qy = (py - half_h).abs() - (half_h - r);
    let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
    let inside = qx.max(qy).min(0.0);
    let distance = outside + inside - r;
    (0.5 - distance).clamp(0.0, 1.0)
}

/// 把照片贴到画布上；`radius > 0` 时做圆角裁剪（边缘抗锯齿）。
pub fn draw_photo(canvas: &mut RgbaImage, photo: &RgbaImage, x: i32, y: i32, radius: f32) {
    if radius <= 0.5 {
        imageops::replace(canvas, photo, x as i64, y as i64);
        return;
    }
    let width = photo.width() as f32;
    let height = photo.height() as f32;
    for (px, py, pixel) in photo.enumerate_pixels() {
        let coverage = rounded_coverage(px as f32 + 0.5, py as f32 + 0.5, width, height, radius);
        if coverage <= 0.001 {
            continue;
        }
        let alpha = (pixel[3] as f32 / 255.0) * coverage;
        blend_pixel(
            canvas,
            x + px as i32,
            y + py as i32,
            [pixel[0] as f32 / 255.0, pixel[1] as f32 / 255.0, pixel[2] as f32 / 255.0, alpha],
        );
    }
}

/// 填充圆角矩形（胶片齿孔、小装饰）。
pub fn fill_rounded_rect(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    color: [f32; 4],
) {
    let x0 = x.floor() as i32 - 1;
    let y0 = y.floor() as i32 - 1;
    let x1 = (x + width).ceil() as i32 + 1;
    let y1 = (y + height).ceil() as i32 + 1;
    for py in y0..=y1 {
        for px in x0..=x1 {
            let coverage =
                rounded_coverage(px as f32 + 0.5 - x, py as f32 + 0.5 - y, width, height, radius);
            if coverage <= 0.001 {
                continue;
            }
            blend_pixel(canvas, px, py, [color[0], color[1], color[2], color[3] * coverage]);
        }
    }
}

/// 由浮点颜色构造 `Rgba`。
pub fn to_rgba(color: [f32; 4]) -> Rgba<u8> {
    Rgba([
        (color[0].clamp(0.0, 1.0) * 255.0).round() as u8,
        (color[1].clamp(0.0, 1.0) * 255.0).round() as u8,
        (color[2].clamp(0.0, 1.0) * 255.0).round() as u8,
        (color[3].clamp(0.0, 1.0) * 255.0).round() as u8,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orientation_swaps_for_rotated_photos() {
        let image = RgbaImage::from_pixel(4, 2, Rgba([255, 0, 0, 255]));
        let rotated = apply_orientation(image, 6);
        assert_eq!((rotated.width(), rotated.height()), (2, 4));
    }

    #[test]
    fn alpha_blending_mixes_colors() {
        let mut canvas = RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 255]));
        blend_pixel(&mut canvas, 0, 0, [1.0, 1.0, 1.0, 0.5]);
        let pixel = canvas.get_pixel(0, 0);
        assert!((pixel[0] as i32 - 128).abs() <= 1);
    }

    #[test]
    fn rounded_rect_fills_center() {
        let mut canvas = RgbaImage::from_pixel(20, 20, Rgba([0, 0, 0, 255]));
        fill_rounded_rect(&mut canvas, 2.0, 2.0, 16.0, 16.0, 6.0, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(canvas.get_pixel(10, 10)[0], 255);
        assert_eq!(canvas.get_pixel(2, 2)[0], 0);
    }
}
