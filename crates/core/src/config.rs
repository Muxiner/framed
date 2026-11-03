//! `RenderConfig`：跨端唯一的配置结构，字段语义见 `docs/CONTRACT.md` §2。

use serde::{Deserialize, Serialize};

/// 边框模板。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FrameTemplate {
    /// 不扩画布，参数叠在照片上。
    None,
    /// 经典白边，底部留出参数栏。
    #[default]
    White,
    /// 拍立得，底部大留白。
    Polaroid,
    /// 胶片：黑边 + 齿孔，文字压在画面上。
    Film,
    /// 纯黑细边。
    Black,
}

impl FrameTemplate {
    pub fn bottom_ratio(self) -> f32 {
        match self {
            Self::White => 3.0,
            Self::Polaroid => 4.2,
            Self::Film => 1.0,
            Self::Black | Self::None => 1.0,
        }
    }

    pub fn background(self) -> &'static str {
        match self {
            Self::White => "#f6f3ee",
            Self::Polaroid => "#f7f4ee",
            _ => "#0b0b0b",
        }
    }

    pub fn margin(self) -> f32 {
        match self {
            Self::None => 0.0,
            Self::White => 0.045,
            Self::Polaroid => 0.05,
            Self::Film => 0.045,
            Self::Black => 0.035,
        }
    }

    pub fn is_dark(self) -> bool {
        matches!(self, Self::Film | Self::Black | Self::None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FontFamily {
    #[default]
    Sans,
    Mono,
    Cjk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AnchorY {
    #[default]
    Top,
    Middle,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    #[default]
    Png,
    Jpeg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    #[default]
    Text,
    Logo,
}

/// 边框参数。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FrameConfig {
    pub template: FrameTemplate,
    /// 边框宽度 / 照片短边。
    pub margin: f32,
    /// 底边宽度倍数（白边 / 拍立得）。
    pub bottom_ratio: f32,
    pub background: String,
    /// 照片圆角 / 照片短边。
    pub radius: f32,
    pub film_holes: bool,
}

impl Default for FrameConfig {
    fn default() -> Self {
        Self::for_template(FrameTemplate::White)
    }
}

impl FrameConfig {
    pub fn for_template(template: FrameTemplate) -> Self {
        Self {
            template,
            margin: template.margin(),
            bottom_ratio: template.bottom_ratio(),
            background: template.background().to_string(),
            radius: 0.0,
            film_holes: true,
        }
    }
}

/// 12 栅格设置（编辑器展示用；渲染按归一化坐标定位）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GridConfig {
    pub columns: u32,
    pub rows: u32,
    pub snap: bool,
    pub visible: bool,
}

impl Default for GridConfig {
    fn default() -> Self {
        Self { columns: 12, rows: 12, snap: true, visible: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OutputConfig {
    pub format: OutputFormat,
    pub quality: u8,
    /// 长边像素上限；0 = 原图。
    pub max_dim: u32,
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self { format: OutputFormat::Png, quality: 92, max_dim: 0 }
    }
}

/// 一个可排版的文字块。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TextBlock {
    pub id: String,
    pub name: String,
    /// 归一化锚点（成品画布）。
    pub x: f32,
    pub y: f32,
    pub align: TextAlign,
    pub align_y: AnchorY,
    pub opacity: f32,
    pub visible: bool,
    pub text: String,
    pub font: FontFamily,
    pub weight: u16,
    /// 字号倍数，基准字号 = min(画布宽, 画布高) * 0.018。
    pub size: f32,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub color: String,
    pub shadow: bool,
}

impl Default for TextBlock {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            x: 0.05,
            y: 0.9,
            align: TextAlign::Left,
            align_y: AnchorY::Top,
            opacity: 1.0,
            visible: true,
            text: String::new(),
            font: FontFamily::Sans,
            weight: 400,
            size: 1.0,
            line_height: 1.35,
            letter_spacing: 0.0,
            color: "#1a1a18".to_string(),
            shadow: false,
        }
    }
}

/// 一个 Logo 图片块。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LogoBlock {
    pub id: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub align: TextAlign,
    pub align_y: AnchorY,
    pub opacity: f32,
    pub visible: bool,
    /// data:image/png;base64,... 或裸 base64。
    pub src: String,
    /// 宽度 / 画布宽度。
    pub width: f32,
}

impl Default for LogoBlock {
    fn default() -> Self {
        Self {
            id: "logo".to_string(),
            name: "Logo".to_string(),
            x: 0.95,
            y: 0.05,
            align: TextAlign::Right,
            align_y: AnchorY::Top,
            opacity: 1.0,
            visible: true,
            src: String::new(),
            width: 0.12,
        }
    }
}

/// 统一的块类型：TS 侧按 `type` 判别，Rust 侧用扁平结构避免反序列化歧义。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Block {
    Text(TextBlock),
    Logo(LogoBlock),
}

impl Block {
    pub fn text(id: &str, name: &str, text: &str) -> Self {
        Self::Text(TextBlock {
            id: id.to_string(),
            name: name.to_string(),
            text: text.to_string(),
            ..TextBlock::default()
        })
    }

    pub fn logo(id: &str, name: &str, src: &str) -> Self {
        Self::Logo(LogoBlock {
            id: id.to_string(),
            name: name.to_string(),
            src: src.to_string(),
            ..LogoBlock::default()
        })
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Text(b) => &b.id,
            Self::Logo(b) => &b.id,
        }
    }

    pub fn position(&self) -> (f32, f32) {
        match self {
            Self::Text(b) => (b.x, b.y),
            Self::Logo(b) => (b.x, b.y),
        }
    }

    pub fn visible(&self) -> bool {
        match self {
            Self::Text(b) => b.visible,
            Self::Logo(b) => b.visible,
        }
    }

    /// 链式设置位置/对齐，默认配置生成时用。
    pub fn at(mut self, x: f32, y: f32, align: TextAlign, align_y: AnchorY) -> Self {
        match &mut self {
            Self::Text(b) => {
                b.x = x;
                b.y = y;
                b.align = align;
                b.align_y = align_y;
            }
            Self::Logo(b) => {
                b.x = x;
                b.y = y;
                b.align = align;
                b.align_y = align_y;
            }
        }
        self
    }

    pub fn style(mut self, font: FontFamily, weight: u16, size: f32, color: &str) -> Self {
        if let Self::Text(b) = &mut self {
            b.font = font;
            b.weight = weight;
            b.size = size;
            b.color = color.to_string();
        }
        self
    }

    pub fn shadow(mut self, shadow: bool) -> Self {
        if let Self::Text(b) = &mut self {
            b.shadow = shadow;
        }
        self
    }

    pub fn opacity(mut self, opacity: f32) -> Self {
        match &mut self {
            Self::Text(b) => b.opacity = opacity,
            Self::Logo(b) => b.opacity = opacity,
        }
        self
    }
}

/// 完整渲染配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RenderConfig {
    pub version: u32,
    pub frame: FrameConfig,
    pub blocks: Vec<Block>,
    pub grid: GridConfig,
    pub output: OutputConfig,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            version: 1,
            frame: FrameConfig::default(),
            blocks: Vec::new(),
            grid: GridConfig::default(),
            output: OutputConfig::default(),
        }
    }
}

/// 解析 `#rrggbb` / `#rgb` / `#rrggbbaa`。
pub fn parse_color(input: &str) -> [f32; 4] {
    let hex = input.trim().trim_start_matches('#');
    let parse = |s: &str| u8::from_str_radix(s, 16).unwrap_or(0) as f32 / 255.0;
    match hex.len() {
        3 => {
            let r = hex.get(0..1).unwrap_or("0");
            let g = hex.get(1..2).unwrap_or("0");
            let b = hex.get(2..3).unwrap_or("0");
            [parse(&format!("{r}{r}")), parse(&format!("{g}{g}")), parse(&format!("{b}{b}")), 1.0]
        }
        6 => [
            parse(hex.get(0..2).unwrap_or("00")),
            parse(hex.get(2..4).unwrap_or("00")),
            parse(hex.get(4..6).unwrap_or("00")),
            1.0,
        ],
        8 => [
            parse(hex.get(0..2).unwrap_or("00")),
            parse(hex.get(2..4).unwrap_or("00")),
            parse(hex.get(4..6).unwrap_or("00")),
            parse(hex.get(6..8).unwrap_or("ff")),
        ],
        _ => [0.0, 0.0, 0.0, 1.0],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{decode_config, encode_config};

    #[test]
    fn template_defaults_are_distinct() {
        assert!(FrameTemplate::White.margin() > 0.0);
        assert_eq!(FrameTemplate::None.margin(), 0.0);
        assert!(FrameTemplate::Polaroid.bottom_ratio() > FrameTemplate::White.bottom_ratio());
        assert!(FrameTemplate::Film.is_dark());
    }

    #[test]
    fn config_roundtrip() {
        let mut config = RenderConfig::default();
        config.blocks.push(
            Block::text("camera", "机型", "SONY α7 IV")
                .at(0.05, 0.9, TextAlign::Left, AnchorY::Top)
                .style(FontFamily::Sans, 600, 1.0, "#111111"),
        );
        let json = encode_config(&config);
        let parsed = decode_config(&json).unwrap();
        assert_eq!(parsed.blocks.len(), 1);
        assert_eq!(parsed.blocks[0].id(), "camera");
    }

    #[test]
    fn parses_colors() {
        assert_eq!(parse_color("#ffffff"), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(parse_color("#000"), [0.0, 0.0, 0.0, 1.0]);
        let rgba = parse_color("#ff000080");
        assert!((rgba[3] - 128.0 / 255.0).abs() < 1e-6);
    }
}
