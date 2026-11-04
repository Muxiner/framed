// 框影 Framed · Tauri v2 桌面壳（原生渲染）
//
// 渲染全部交给 `framed_core`，不加载 wasm；前端通过 `window.__TAURI__.core.invoke`
// 调用（withGlobalTauri: true）。与 Web / wasm 端共享同一套 RenderConfig JSON
// （见 docs/CONTRACT.md §2），`render_image` 的返回格式与 WASM C ABI 一致（§3.2）：
//
//   [0..4)             meta JSON 字节长度（u32，小端）
//   [4..4+meta_len)    meta JSON：{ok:true,width,height,blocks} 或 {ok:false,error}
//   [4+meta_len..+4)   二进制长度（u32，小端）
//   [..+bin_len)       PNG / JPEG 字节

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde_json::{json, Map, Value};
use tauri::ipc::Response;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// `render_image`（预览）内部把长边限制到该值（CONTRACT §3.3）。
const PREVIEW_MAX_DIM: u32 = 1600;

/// 预览底图的长边（照片本身，不含边框）：解码 + 缩放只做一次，
/// 之后每次改参数只重新合成与编码。
const PREVIEW_PHOTO_DIM: u32 = 1400;

/// 当前照片 + 多图缓存（多图模式下每张照片只上传一次，切换按 id 取）。
struct PhotoCache(Mutex<PhotoState>);

#[derive(Default)]
struct PhotoState {
    current: Option<String>,
    photos: HashMap<String, Vec<u8>>,
    /// 当前照片的预览底图（已解码 / 转正 / 缩放），随当前照片缓存。
    preview: Option<(String, Arc<framed_core::PreparedPhoto>)>,
}

static PHOTO_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn new_photo_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = PHOTO_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("photo-{nanos:x}-{sequence}")
}

/// 一次原生渲染的结果。
struct Rendered {
    /// 带 `ok: true` 的 RenderMeta JSON（测试里用于校验打包格式）。
    #[allow(dead_code)]
    meta_json: String,
    /// 渲染后的图片字节（PNG / JPEG）。
    bytes: Vec<u8>,
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/// 解码前端传来的 base64；同时容忍 data URL 前缀、URL-safe 与缺失 padding。
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let compact: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let payload = compact.rsplit(',').next().unwrap_or(compact.as_str());
    if payload.is_empty() {
        return Err("图片数据为空".to_string());
    }
    if let Ok(bytes) = STANDARD.decode(payload) {
        return Ok(bytes);
    }
    if let Ok(bytes) = URL_SAFE.decode(payload) {
        return Ok(bytes);
    }
    URL_SAFE_NO_PAD.decode(payload).map_err(|err| format!("base64 解码失败：{err}"))
}

/// 打包为 [u32 meta_len][meta][u32 bin_len][bin]。
fn pack(meta_json: &str, bin: &[u8]) -> Vec<u8> {
    let meta = meta_json.as_bytes();
    let mut out = Vec::with_capacity(8 + meta.len() + bin.len());
    out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    out.extend_from_slice(meta);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(bin);
    out
}

/// 错误也按同一格式返回（bin 长度 0），由前端 parsePacked 统一抛错。
fn pack_error(message: &str) -> Vec<u8> {
    pack(&json!({ "ok": false, "error": message }).to_string(), &[])
}

/// 缓存里取当前照片（克隆一份，避免长时间持锁）。
fn current_photo(state: &State<'_, PhotoCache>) -> Result<Vec<u8>, String> {
    let guard = state.0.lock().map_err(|_| "照片缓存锁已损坏，请重新加载照片".to_string())?;
    let id = guard.current.clone().ok_or_else(|| "尚未载入照片，请先上传照片".to_string())?;
    guard.photos.get(&id).cloned().ok_or_else(|| "当前照片不在缓存中，请重新导入".to_string())
}

/// 当前照片的预览底图；缓存未命中时现做一次（解码 + 缩放 ~200ms）。
fn current_preview(
    state: &State<'_, PhotoCache>,
) -> Result<Arc<framed_core::PreparedPhoto>, String> {
    let guard = state.0.lock().map_err(|_| "照片缓存锁已损坏".to_string())?;
    let id = guard.current.clone().ok_or_else(|| "尚未载入照片，请先上传照片".to_string())?;
    if let Some((cached_id, prepared)) = &guard.preview {
        if cached_id == &id {
            return Ok(prepared.clone());
        }
    }
    let bytes = guard
        .photos
        .get(&id)
        .cloned()
        .ok_or_else(|| "当前照片不在缓存中，请重新导入".to_string())?;
    drop(guard);

    let prepared = Arc::new(
        framed_core::prepare_photo(&bytes, PREVIEW_PHOTO_DIM)
            .map_err(|err| format!("准备预览失败：{err}"))?,
    );
    let mut guard = state.0.lock().map_err(|_| "照片缓存锁已损坏".to_string())?;
    if guard.current.as_deref() == Some(id.as_str()) {
        guard.preview = Some((id, prepared.clone()));
    }
    Ok(prepared)
}

/// 按 id 取已缓存照片字节。
fn photo_bytes(state: &State<'_, PhotoCache>, id: &str) -> Result<Vec<u8>, String> {
    let guard = state.0.lock().map_err(|_| "照片缓存锁已损坏".to_string())?;
    guard.photos.get(id).cloned().ok_or_else(|| format!("照片 {id} 不在缓存中，请重新导入"))
}

/// 只保留安全的文件名字符，避免路径穿越。
fn sanitize_filename(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ' | '(' | ')') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    cleaned = cleaned.trim_matches(['-', '.', ' ']).to_string();
    if cleaned.is_empty() {
        cleaned = "framed.png".to_string();
    }
    if cleaned.chars().count() > 160 {
        cleaned = cleaned.chars().take(160).collect();
    }
    cleaned
}

/// 原生渲染一次；`preview` 时把 output.maxDim 限制到 1600。
fn render_photo(photo: &[u8], config_json: &str, preview: bool) -> Result<Rendered, String> {
    let mut config: framed_core::RenderConfig =
        serde_json::from_str(config_json).map_err(|err| format!("渲染配置解析失败：{err}"))?;

    if preview {
        let max_dim = config.output.max_dim;
        config.output.max_dim =
            if max_dim == 0 || max_dim > PREVIEW_MAX_DIM { PREVIEW_MAX_DIM } else { max_dim };
    }

    let output = framed_core::render(photo, &config).map_err(|err| format!("渲染失败：{err}"))?;

    // meta JSON 内注入 ok:true，与 wasm 段的调用方约定对齐。
    let mut meta = match serde_json::to_value(&output.meta)
        .map_err(|err| format!("渲染元数据序列化失败：{err}"))?
    {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("meta".to_string(), other);
            map
        }
    };
    meta.insert("ok".to_string(), Value::Bool(true));

    Ok(Rendered { meta_json: Value::Object(meta).to_string(), bytes: output.bytes })
}

/// 预览渲染（热路径）：复用已解码底图，只合成 + JPEG 编码。
fn render_preview_photo(
    prepared: &framed_core::PreparedPhoto,
    config_json: &str,
) -> Result<Rendered, String> {
    let mut config: framed_core::RenderConfig =
        serde_json::from_str(config_json).map_err(|err| format!("渲染配置解析失败：{err}"))?;
    config.output.format = framed_core::config::OutputFormat::Jpeg;
    config.output.quality = 90;
    config.output.max_dim = 0;

    let output = framed_core::render_prepared(prepared, &config)
        .map_err(|err| format!("渲染失败：{err}"))?;
    let mut meta = match serde_json::to_value(&output.meta)
        .map_err(|err| format!("渲染元数据序列化失败：{err}"))?
    {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("meta".to_string(), other);
            map
        }
    };
    meta.insert("ok".to_string(), Value::Bool(true));
    Ok(Rendered { meta_json: Value::Object(meta).to_string(), bytes: output.bytes })
}

/// 根据配置里的 output.format 决定保存扩展名与过滤器名称。
fn output_extension(config_json: &str) -> (&'static str, &'static str) {
    let format = serde_json::from_str::<Value>(config_json)
        .ok()
        .and_then(|value| {
            value
                .get("output")
                .and_then(|output| output.get("format"))
                .and_then(Value::as_str)
                .map(str::to_ascii_lowercase)
        })
        .unwrap_or_else(|| "png".to_string());
    match format.as_str() {
        "jpeg" | "jpg" => ("jpg", "JPEG 图片"),
        _ => ("png", "PNG 图片"),
    }
}

/// 保证建议文件名带正确扩展名。
fn ensure_extension(suggested: &str, ext: &str) -> String {
    let name = suggested.trim();
    let name = if name.is_empty() { "framed" } else { name };
    let current = std::path::Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let ok = current == ext || (ext == "jpg" && current == "jpeg");
    if ok {
        name.to_string()
    } else {
        format!("{name}.{ext}")
    }
}

// ---------------------------------------------------------------------------
// Tauri 命令（CONTRACT §3.3）
// ---------------------------------------------------------------------------

/// 原生解码 + 探测 EXIF，并缓存当前照片字节。
#[tauri::command(async)]
fn load_image(
    data_b64: String,
    photo_id: Option<String>,
    state: State<'_, PhotoCache>,
) -> Result<framed_core::PhotoInfo, String> {
    let bytes = decode_base64(&data_b64)?;
    let info = framed_core::probe(&bytes).map_err(|err| format!("解析照片失败：{err}"))?;
    let id = photo_id.filter(|id| !id.is_empty()).unwrap_or_else(new_photo_id);
    {
        let mut guard = state.0.lock().map_err(|_| "照片缓存锁已损坏".to_string())?;
        guard.photos.insert(id.clone(), bytes);
        guard.current = Some(id);
        guard.preview = None;
    }
    Ok(info)
}

/// 切换到已缓存的照片（多图模式），不重复传输图片字节。
#[tauri::command(async)]
fn select_image(
    photo_id: String,
    state: State<'_, PhotoCache>,
) -> Result<framed_core::PhotoInfo, String> {
    let bytes = photo_bytes(&state, &photo_id)?;
    let info = framed_core::probe(&bytes).map_err(|err| format!("解析照片失败：{err}"))?;
    let prepared = Arc::new(
        framed_core::prepare_photo(&bytes, PREVIEW_PHOTO_DIM)
            .map_err(|err| format!("准备预览失败：{err}"))?,
    );
    {
        let mut guard = state.0.lock().map_err(|_| "照片缓存锁已损坏".to_string())?;
        guard.current = Some(photo_id.clone());
        guard.preview = Some((photo_id, prepared));
    }
    Ok(info)
}

/// 依据 EXIF 与模板生成默认 RenderConfig（JSON 字符串）。
#[tauri::command(async)]
fn default_config(photo_json: String, template: String) -> Result<String, String> {
    let photo: framed_core::PhotoInfo =
        serde_json::from_str(&photo_json).map_err(|err| format!("PhotoInfo 解析失败：{err}"))?;
    let template: framed_core::FrameTemplate =
        serde_json::from_value(Value::String(template.clone()))
            .map_err(|err| format!("未知模板 “{template}”：{err}"))?;
    let config = framed_core::default_config(&photo, template);
    serde_json::to_string(&config).map_err(|err| format!("RenderConfig 序列化失败：{err}"))
}

/// 渲染当前照片，返回打包的 [meta][bin]（见文件头注释）。
#[tauri::command(async)]
fn render_image(config_json: String, state: State<'_, PhotoCache>) -> Response {
    let result = (|| -> Result<Vec<u8>, String> {
        let prepared = current_preview(&state)?;
        let rendered = render_preview_photo(prepared.as_ref(), &config_json)?;
        Ok(pack(&rendered.meta_json, &rendered.bytes))
    })();

    Response::new(match result {
        Ok(bytes) => bytes,
        Err(message) => pack_error(&message),
    })
}

/// 渲染原始尺寸并通过系统保存框写文件；用户取消返回 None。
#[tauri::command(async)]
fn export_image(
    app: tauri::AppHandle,
    config_json: String,
    suggested_name: String,
    state: State<'_, PhotoCache>,
) -> Result<Option<String>, String> {
    let photo = current_photo(&state)?;
    let rendered = render_photo(&photo, &config_json, false)?;

    let (ext, label) = output_extension(&config_json);
    let file_name = ensure_extension(&suggested_name, ext);

    let picked = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(label, &[ext])
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path.into_path().map_err(|err| format!("保存路径无效：{err}"))?;
    std::fs::write(&path, &rendered.bytes).map_err(|err| format!("写入文件失败：{err}"))?;
    Ok(Some(path.display().to_string()))
}

/// 批量导出：选一次目录，把当前缓存里的多张照片按各自配置渲染写入。
#[tauri::command(async)]
fn export_batch(
    app: tauri::AppHandle,
    items_json: String,
    state: State<'_, PhotoCache>,
) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct BatchItem {
        id: String,
        filename: String,
        config: framed_core::RenderConfig,
    }

    let items: Vec<BatchItem> =
        serde_json::from_str(&items_json).map_err(|err| format!("批量导出参数解析失败：{err}"))?;
    if items.is_empty() {
        return Ok(json!({ "saved": 0, "paths": [], "canceled": false }));
    }

    // 先渲染，失败直接报错；再让用户选目录。
    let mut rendered: Vec<(String, Vec<u8>)> = Vec::with_capacity(items.len());
    for item in &items {
        let bytes = photo_bytes(&state, &item.id)?;
        let config_json = serde_json::to_string(&item.config)
            .map_err(|err| format!("批量导出配置序列化失败：{err}"))?;
        let output = render_photo(&bytes, &config_json, false)?;
        rendered.push((sanitize_filename(&item.filename), output.bytes));
    }

    let picked = app.dialog().file().set_title("选择批量导出文件夹").blocking_pick_folder();
    let Some(folder) = picked else {
        return Ok(json!({ "saved": 0, "paths": [], "canceled": true }));
    };
    let folder = folder.into_path().map_err(|err| format!("目录路径无效：{err}"))?;
    std::fs::create_dir_all(&folder).map_err(|err| format!("创建目录失败：{err}"))?;

    let mut paths = Vec::with_capacity(rendered.len());
    for (filename, bytes) in rendered {
        let path = folder.join(filename);
        std::fs::write(&path, &bytes).map_err(|err| format!("写入文件失败：{err}"))?;
        paths.push(path.display().to_string());
    }

    Ok(json!({ "saved": paths.len(), "paths": paths, "canceled": false }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PhotoCache(Mutex::new(PhotoState::default())))
        .invoke_handler(tauri::generate_handler![
            load_image,
            select_image,
            default_config,
            render_image,
            export_image,
            export_batch
        ])
        .run(tauri::generate_context!())
        .expect("框影 Framed 启动失败");
}

// ---------------------------------------------------------------------------
// 单元测试：覆盖跨端打包格式、渲染路径与保存文件名（不依赖 GUI / 对话框）。
// 运行：CARGO_HOME=... cargo test --release （在 src-tauri 目录内）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 4×4 纯灰 PNG（最小可解码图片，避免引入测试资源文件）。
    const TINY_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x08, 0x02, 0x00, 0x00, 0x00, 0x26,
        0x93, 0x09, 0x29, 0x00, 0x00, 0x00, 0x13, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x0c,
        0x08, 0x08, 0x60, 0x80, 0x01, 0x26, 0x38, 0x0b, 0x2f, 0x07, 0x00, 0x2f, 0xe4, 0x00, 0xf8,
        0xf8, 0x22, 0xdb, 0x15, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
        0x82,
    ];

    /// 解包 [u32 meta_len][meta][u32 bin_len][bin]。
    fn unpack(packed: &[u8]) -> (Value, &[u8]) {
        let meta_len = u32::from_le_bytes(packed[0..4].try_into().unwrap()) as usize;
        let meta: Value = serde_json::from_slice(&packed[4..4 + meta_len]).unwrap();
        let bin_header = 4 + meta_len;
        let bin_len =
            u32::from_le_bytes(packed[bin_header..bin_header + 4].try_into().unwrap()) as usize;
        let bin = &packed[bin_header + 4..bin_header + 4 + bin_len];
        (meta, bin)
    }

    /// probe → default_config → render → pack 全链路（与 render_image 命令同一路径）。
    #[test]
    fn native_render_packs_contract_format() {
        let photo = framed_core::probe(TINY_PNG).expect("probe 应成功");
        assert_eq!((photo.width, photo.height), (4, 4));

        let config = framed_core::default_config(&photo, framed_core::FrameTemplate::White);
        let config_json = serde_json::to_string(&config).expect("配置应可序列化");

        let rendered = render_photo(TINY_PNG, &config_json, true).expect("原生渲染应成功");
        assert_eq!(&rendered.bytes[..8], b"\x89PNG\r\n\x1a\n", "预览应为 PNG");

        let packed = pack(&rendered.meta_json, &rendered.bytes);
        let (meta, bin) = unpack(&packed);
        assert_eq!(meta["ok"], Value::Bool(true));
        assert!(meta["width"].as_u64().unwrap() > 0);
        assert_eq!(bin, rendered.bytes.as_slice());
    }

    /// 错误统一按 {ok:false,error} 打包，且 bin 为空。
    #[test]
    fn errors_use_packed_json() {
        let packed = pack_error("渲染失败：测试");
        let (meta, bin) = unpack(&packed);
        assert_eq!(meta["ok"], Value::Bool(false));
        assert_eq!(meta["error"], Value::String("渲染失败：测试".into()));
        assert!(bin.is_empty());

        // 空图渲染走错误分支
        let err = render_photo(&[], "{}", true);
        assert!(err.is_err());
    }

    /// base64 解码容忍标准 / data URL 前缀。
    #[test]
    fn base64_decoding_is_tolerant() {
        use base64::engine::general_purpose::STANDARD;
        let encoded = STANDARD.encode(TINY_PNG);
        assert_eq!(decode_base64(&encoded).unwrap(), TINY_PNG);
        let data_url = format!("data:image/png;base64,{encoded}");
        assert_eq!(decode_base64(&data_url).unwrap(), TINY_PNG);
        assert!(decode_base64("").is_err());
    }

    /// 预览走缓存底图 + JPEG，尺寸来自底图而非原图。
    #[test]
    fn preview_uses_cached_jpeg() {
        let prepared =
            framed_core::prepare_photo(TINY_PNG, PREVIEW_PHOTO_DIM).expect("prepare 应成功");
        let photo = framed_core::probe(TINY_PNG).expect("probe 应成功");
        let config = framed_core::default_config(&photo, framed_core::FrameTemplate::White);
        let config_json = serde_json::to_string(&config).unwrap();

        let rendered = render_preview_photo(&prepared, &config_json).expect("预览渲染应成功");
        assert_eq!(&rendered.bytes[..2], &[0xFF, 0xD8], "预览应为 JPEG");
        let meta: Value = serde_json::from_str(&rendered.meta_json).unwrap();
        assert_eq!(meta["ok"], Value::Bool(true));
        assert!(meta["width"].as_u64().unwrap() >= 4);
    }

    /// 批量导出文件名过滤路径分隔符，防止写出目录。
    #[test]
    fn sanitize_filename_blocks_traversal() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_filename("照片 01.png"), "照片 01.png");
        assert_eq!(sanitize_filename(""), "framed.png");
        assert_eq!(sanitize_filename("a/b\\c.png"), "a-b-c.png");
    }

    /// 导出扩展名跟随 output.format，且不重复追加。
    #[test]
    fn export_name_follows_format() {
        assert_eq!(output_extension(r#"{"output":{"format":"jpeg"}}"#).0, "jpg");
        assert_eq!(output_extension(r#"{"output":{"format":"png"}}"#).0, "png");
        assert_eq!(output_extension("{}").0, "png");
        assert_eq!(ensure_extension("", "png"), "framed.png");
        assert_eq!(ensure_extension("framed", "png"), "framed.png");
        assert_eq!(ensure_extension("shot.jpeg", "jpg"), "shot.jpeg");
        assert_eq!(ensure_extension("shot.png", "jpg"), "shot.png.jpg");
    }
}
