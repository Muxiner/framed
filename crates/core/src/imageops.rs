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
pub(crate) fn rounded_coverage(px: f32, py: f32, width: f32, height: f32, radius: f32) -> f32 {
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

/// 可分离盒式模糊（f32 蒙版）。
fn blur_mask(mask: &[f32], width: usize, height: usize, radius: f32) -> Vec<f32> {
    let radius = radius.round().max(0.0) as usize;
    if radius == 0 || width == 0 || height == 0 {
        return mask.to_vec();
    }
    let radius = radius.min(width.max(height));
    let window = (radius * 2 + 1) as f32;
    let mut horizontal = vec![0.0_f32; mask.len()];
    let mut output = vec![0.0_f32; mask.len()];

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

/// 照片外阴影：在照片背后画一层带方向、模糊、扩散的投影。
#[allow(clippy::too_many_arguments)]
pub fn draw_outer_shadow(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    offset_x: f32,
    offset_y: f32,
    spread: f32,
    blur: f32,
    color: [f32; 4],
    opacity: f32,
) {
    if width <= 0.0 || height <= 0.0 || opacity <= 0.0 {
        return;
    }
    let spread = spread.max(-width.min(height) / 2.0);
    let pad = blur.max(0.0) * 2.0 + offset_x.abs().max(offset_y.abs()) + spread.abs() + 2.0;
    let x0 = (x - pad).floor() as i32;
    let y0 = (y - pad).floor() as i32;
    let x1 = (x + width + pad).ceil() as i32;
    let y1 = (y + height + pad).ceil() as i32;
    let (mask_w, mask_h) = ((x1 - x0).max(1) as usize, (y1 - y0).max(1) as usize);
    let rect_x = x - spread;
    let rect_y = y - spread;
    let rect_w = width + spread * 2.0;
    let rect_h = height + spread * 2.0;
    let rect_radius = (radius + spread).max(0.0);
    let mut mask = vec![0.0_f32; mask_w * mask_h];

    for py in 0..mask_h {
        for px in 0..mask_w {
            let gx = x0 as f32 + px as f32 + 0.5 - offset_x;
            let gy = y0 as f32 + py as f32 + 0.5 - offset_y;
            mask[py * mask_w + px] =
                rounded_coverage(gx - rect_x, gy - rect_y, rect_w, rect_h, rect_radius);
        }
    }
    let blurred = blur_mask(&mask, mask_w, mask_h, blur.max(0.0) * 0.6);

    for py in 0..mask_h {
        for px in 0..mask_w {
            let alpha = blurred[py * mask_w + px] * opacity * color[3];
            if alpha <= 0.001 {
                continue;
            }
            blend_pixel(
                canvas,
                x0 + px as i32,
                y0 + py as i32,
                [color[0], color[1], color[2], alpha],
            );
        }
    }
}

/// 照片内阴影：沿照片内侧边缘向内投射的阴影。
#[allow(clippy::too_many_arguments)]
pub fn draw_inner_shadow(
    canvas: &mut RgbaImage,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
    offset_x: f32,
    offset_y: f32,
    spread: f32,
    blur: f32,
    color: [f32; 4],
    opacity: f32,
) {
    if width <= 0.0 || height <= 0.0 || opacity <= 0.0 {
        return;
    }
    let pad = blur.max(0.0) * 2.0 + offset_x.abs().max(offset_y.abs()) + spread.abs() + 2.0;
    let x0 = (x - pad).floor() as i32;
    let y0 = (y - pad).floor() as i32;
    let x1 = (x + width + pad).ceil() as i32;
    let y1 = (y + height + pad).ceil() as i32;
    let (mask_w, mask_h) = ((x1 - x0).max(1) as usize, (y1 - y0).max(1) as usize);
    let rect_x = x - spread;
    let rect_y = y - spread;
    let rect_w = width + spread * 2.0;
    let rect_h = height + spread * 2.0;
    let rect_radius = (radius + spread).max(0.0);
    let mut mask = vec![0.0_f32; mask_w * mask_h];

    // 取「照片外」蒙版并平移：照片内侧靠近偏移方向的一侧会得到阴影。
    for py in 0..mask_h {
        for px in 0..mask_w {
            let gx = x0 as f32 + px as f32 + 0.5 - offset_x;
            let gy = y0 as f32 + py as f32 + 0.5 - offset_y;
            let inside = rounded_coverage(gx - rect_x, gy - rect_y, rect_w, rect_h, rect_radius);
            mask[py * mask_w + px] = 1.0 - inside;
        }
    }
    let blurred = blur_mask(&mask, mask_w, mask_h, blur.max(0.0) * 0.6);

    for py in 0..mask_h {
        for px in 0..mask_w {
            let gx = x0 as f32 + px as f32 + 0.5;
            let gy = y0 as f32 + py as f32 + 0.5;
            let inside = rounded_coverage(gx - x, gy - y, width, height, radius);
            if inside <= 0.001 {
                continue;
            }
            let alpha = blurred[py * mask_w + px] * inside * opacity * color[3];
            if alpha <= 0.001 {
                continue;
            }
            blend_pixel(
                canvas,
                x0 + px as i32,
                y0 + py as i32,
                [color[0], color[1], color[2], alpha],
            );
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
