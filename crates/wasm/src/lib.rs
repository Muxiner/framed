//! 框影 Framed 的 WebAssembly 导出层。
//!
//! 不依赖 wasm-bindgen：手写 C ABI + 打包缓冲区，前端只需
//! `WebAssembly.instantiate`，打包格式见 `docs/CONTRACT.md` §3.2。

use std::slice;
use std::sync::Mutex;

use framed_core::config::{FrameTemplate, OutputFormat};
use framed_core::{PhotoInfo, PreparedPhoto, RenderConfig};
use serde_json::{json, Value};

const OK: &str = "ok";

/// 预览用的照片缓存：解码 + 转正 + 缩放一次，之后每次改参数只做合成与编码。
static PREPARED: Mutex<Option<PreparedPhoto>> = Mutex::new(None);

fn with_prepared<R>(f: impl FnOnce(Option<&PreparedPhoto>) -> R) -> R {
    let guard = PREPARED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(guard.as_ref())
}

#[no_mangle]
pub extern "C" fn framed_alloc(len: u32) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len as usize);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` 必须来自 `framed_alloc`，且 `len` 与分配时一致。
#[no_mangle]
pub unsafe extern "C" fn framed_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    let slice = slice::from_raw_parts_mut(ptr, len as usize);
    drop(Box::from_raw(slice as *mut [u8]));
}

fn pack(json: &Value, bin: &[u8]) -> *mut u8 {
    let payload = framed_core::pack_result(&json.to_string(), bin);
    let boxed = payload.into_boxed_slice();
    Box::into_raw(boxed) as *mut u8
}

fn error(message: &str) -> *mut u8 {
    pack(&json!({ "ok": false, "error": message }), &[])
}

fn ok_json(value: Value) -> *mut u8 {
    let mut value = value;
    if let Some(map) = value.as_object_mut() {
        map.insert(OK.to_string(), Value::Bool(true));
    }
    pack(&value, &[])
}

/// # Safety
/// `ptr/len` 必须描述一段有效的 UTF-8 输入字节。
unsafe fn input(ptr: *const u8, len: u32) -> &'static [u8] {
    slice::from_raw_parts(ptr, len as usize)
}

/// 探测照片尺寸与 EXIF。
///
/// # Safety
/// `ptr/len` 必须是调用方通过 `framed_alloc` 写入的有效字节区间。
#[no_mangle]
pub unsafe extern "C" fn framed_probe(ptr: *const u8, len: u32) -> *mut u8 {
    let bytes = input(ptr, len);
    match framed_core::probe(bytes) {
        Ok(info) => ok_json(serde_json::to_value(info).unwrap_or_else(|_| json!({}))),
        Err(err) => error(&err.to_string()),
    }
}

/// 输入 `{ photo, template }`，输出默认 RenderConfig。
///
/// # Safety
/// `ptr/len` 必须是调用方通过 `framed_alloc` 写入的有效 UTF-8 区间。
#[no_mangle]
pub unsafe extern "C" fn framed_default_config(ptr: *const u8, len: u32) -> *mut u8 {
    let bytes = input(ptr, len);
    let request: Value = match serde_json::from_slice(bytes) {
        Ok(value) => value,
        Err(err) => return error(&format!("配置解析失败: {err}")),
    };
    let Some(photo) = request.get("photo") else {
        return error("缺少 photo 参数");
    };
    let photo: PhotoInfo = match serde_json::from_value(photo.clone()) {
        Ok(photo) => photo,
        Err(err) => return error(&format!("photo 解析失败: {err}")),
    };
    let template: FrameTemplate = request
        .get("template")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default();
    let config = framed_core::default_config(&photo, template);
    ok_json(serde_json::to_value(config).unwrap_or_else(|_| json!({})))
}

/// 注册用户字体（ttf/otf）：`id` 为文本块 `customFont` 里引用的名字。
///
/// # Safety
/// 两段 `(ptr, len)` 必须都是调用方通过 `framed_alloc` 写入的有效字节区间。
#[no_mangle]
pub unsafe extern "C" fn framed_register_font(
    id_ptr: *const u8,
    id_len: u32,
    data_ptr: *const u8,
    data_len: u32,
) -> *mut u8 {
    let id = match std::str::from_utf8(input(id_ptr, id_len)) {
        Ok(id) => id,
        Err(err) => return error(&format!("字体 id 不是合法 UTF-8：{err}")),
    };
    match framed_core::register_user_font(id, input(data_ptr, data_len)) {
        Ok(()) => ok_json(json!({ "id": id })),
        Err(err) => error(&err),
    }
}

/// 移除用户字体。
///
/// # Safety
/// `ptr/len` 必须是调用方通过 `framed_alloc` 写入的有效 UTF-8 区间。
#[no_mangle]
pub unsafe extern "C" fn framed_remove_font(ptr: *const u8, len: u32) -> *mut u8 {
    match std::str::from_utf8(input(ptr, len)) {
        Ok(id) => {
            framed_core::remove_user_font(id);
            ok_json(json!({ "id": id }))
        }
        Err(err) => error(&format!("字体 id 不是合法 UTF-8：{err}")),
    }
}

/// 解码 + 转正 + 缩放到 `max_dim`，缓存为预览底图；返回 PhotoInfo。
///
/// # Safety
/// `ptr/len` 必须是调用方通过 `framed_alloc` 写入的有效图片字节区间。
#[no_mangle]
pub unsafe extern "C" fn framed_prepare(ptr: *const u8, len: u32, max_dim: u32) -> *mut u8 {
    let bytes = input(ptr, len);
    let prepared = match framed_core::prepare_photo(bytes, max_dim) {
        Ok(prepared) => prepared,
        Err(err) => return error(&err.to_string()),
    };
    let info = match framed_core::probe(bytes) {
        Ok(info) => info,
        Err(err) => return error(&err.to_string()),
    };
    {
        let mut guard = PREPARED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = Some(prepared);
    }
    ok_json(serde_json::to_value(info).unwrap_or_else(|_| json!({})))
}

/// 用缓存好的预览底图渲染：返回 `{meta}` + JPEG 字节（预览专用，热路径）。
///
/// # Safety
/// `cfg_ptr/cfg_len` 必须是调用方通过 `framed_alloc` 写入的有效 RenderConfig JSON。
#[no_mangle]
pub unsafe extern "C" fn framed_render_preview(cfg_ptr: *const u8, cfg_len: u32) -> *mut u8 {
    let mut config: RenderConfig = match serde_json::from_slice(input(cfg_ptr, cfg_len)) {
        Ok(config) => config,
        Err(err) => return error(&format!("配置解析失败: {err}")),
    };
    // 预览统一用 JPEG，编码比 PNG 快一个量级；尺寸由缓存底图决定。
    config.output.format = OutputFormat::Jpeg;
    config.output.quality = 90;
    config.output.max_dim = 0;

    with_prepared(|prepared| {
        let Some(prepared) = prepared else {
            return error("尚未准备预览底图");
        };
        match framed_core::render_prepared(prepared, &config) {
            Ok(output) => {
                let mut meta = serde_json::to_value(&output.meta).unwrap_or_else(|_| json!({}));
                if let Some(map) = meta.as_object_mut() {
                    map.insert(OK.to_string(), Value::Bool(true));
                }
                pack(&meta, &output.bytes)
            }
            Err(err) => error(&err.to_string()),
        }
    })
}

/// 渲染：输入照片字节 + RenderConfig JSON，返回 `{meta}` 与编码后的图片字节。
///
/// # Safety
/// 两段 `(ptr, len)` 必须都是调用方通过 `framed_alloc` 写入的有效字节区间。
#[no_mangle]
pub unsafe extern "C" fn framed_render(
    img_ptr: *const u8,
    img_len: u32,
    cfg_ptr: *const u8,
    cfg_len: u32,
) -> *mut u8 {
    let image = input(img_ptr, img_len);
    let config: RenderConfig = match serde_json::from_slice(input(cfg_ptr, cfg_len)) {
        Ok(config) => config,
        Err(err) => return error(&format!("配置解析失败: {err}")),
    };
    match framed_core::render(image, &config) {
        Ok(output) => {
            let mut meta = serde_json::to_value(&output.meta).unwrap_or_else(|_| json!({}));
            if let Some(map) = meta.as_object_mut() {
                map.insert(OK.to_string(), Value::Bool(true));
            }
            pack(&meta, &output.bytes)
        }
        Err(err) => error(&err.to_string()),
    }
}
