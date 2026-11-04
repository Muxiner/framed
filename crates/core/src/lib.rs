//! 框影 Framed 渲染内核。
//!
//! 一次实现，多端复用：原生（Tauri / CLI）与 WebAssembly 共用同一套排版、
//! EXIF 解析与光栅化逻辑，保证桌面端与网页端导出的图完全一致。
//!
//! 顶层只暴露少量入口：
//! - [`probe`]：读取尺寸与 EXIF
//! - [`default_config`]：根据照片与模板生成默认排版
//! - [`render`]：按 [`RenderConfig`] 渲染并编码

pub mod config;
pub mod exif;
pub mod fonts;
pub mod imageops;
pub mod layout;
pub mod render;
pub mod text;

pub use config::{
    Block, BlockKind, FontFamily, FrameConfig, FrameTemplate, GridConfig, LogoBlock, OutputConfig,
    OutputFormat, PhotoShadowConfig, RenderConfig, ShadowMode, TextAlign, TextBlock,
};
pub use exif::{probe, ExifInfo, PhotoInfo};
pub use fonts::{register_user_font, remove_user_font, user_font_ids};
pub use layout::{default_config, geometry, Geometry};
pub use render::{
    prepare_photo, render, render_prepared, BlockRect, PreparedPhoto, RenderMeta, RenderOutput,
};

/// 内核统一错误类型。
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("图片解码失败: {0}")]
    Image(String),
    #[error("EXIF 解析失败: {0}")]
    Exif(String),
    #[error("配置解析失败: {0}")]
    Config(String),
    #[error("渲染失败: {0}")]
    Render(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

/// 解析配置 JSON。
pub fn decode_config(json: &str) -> Result<RenderConfig> {
    serde_json::from_str(json).map_err(|err| EngineError::Config(err.to_string()))
}

/// 序列化配置为 JSON。
pub fn encode_config(config: &RenderConfig) -> String {
    serde_json::to_string(config).expect("RenderConfig 序列化不应失败")
}

/// 把 JSON 头与二进制负载打包成跨端传输格式：
/// `[u32 json_len][json][u32 bin_len][bin]`（小端）。
pub fn pack_result(json: &str, bin: &[u8]) -> Vec<u8> {
    let json = json.as_bytes();
    let mut out = Vec::with_capacity(4 + json.len() + 4 + bin.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(json);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(bin);
    out
}
