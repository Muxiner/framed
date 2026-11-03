//! 框影 Framed 的 WebAssembly 导出层。
//!
//! 不依赖 wasm-bindgen：手写 C ABI + 打包缓冲区，前端只需
//! `WebAssembly.instantiate`，打包格式见 `docs/CONTRACT.md` §3.2。

use std::slice;

use framed_core::{config::FrameTemplate, PhotoInfo, RenderConfig};
use serde_json::{json, Value};

const OK: &str = "ok";

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
