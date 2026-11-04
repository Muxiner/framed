//! 内嵌字体、用户上传字体与字族回退。
//!
//! 内置字体是 Google Fonts 的子集（OFL 授权，见 `assets/fonts/OFL-*.txt`）：
//! - Inter：拉丁无衬线（机型、水印）
//! - JetBrains Mono：参数行（数字等宽，取景器质感）
//! - Noto Sans SC：中文与兜底
//!
//! 用户可以通过 `register_user_font` 上传 ttf/otf；文本块用 `customFont` 指定
//! 字体 id，找不到或字形缺失时按内置字体回退。

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use ab_glyph::{Font, FontArc};

use crate::config::FontFamily;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Face {
    Sans,
    SansBold,
    Mono,
    MonoBold,
    Cjk,
    CjkBold,
}

impl Face {
    fn index(self) -> usize {
        match self {
            Self::Sans => 0,
            Self::SansBold => 1,
            Self::Mono => 2,
            Self::MonoBold => 3,
            Self::Cjk => 4,
            Self::CjkBold => 5,
        }
    }
}

/// 一次渲染可用的字体引用：内置字体或本次快照中的用户字体。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceRef {
    Builtin(Face),
    User(usize),
}

pub struct FontSet {
    faces: [FontArc; 6],
    user: Vec<(String, FontArc)>,
}

static BUILTIN: OnceLock<[FontArc; 6]> = OnceLock::new();
static USER_FONTS: OnceLock<RwLock<HashMap<String, FontArc>>> = OnceLock::new();

fn builtin() -> &'static [FontArc; 6] {
    BUILTIN.get_or_init(|| {
        fn face(bytes: &'static [u8], name: &str) -> FontArc {
            FontArc::try_from_slice(bytes)
                .unwrap_or_else(|err| panic!("内嵌字体 {name} 解析失败：{err}"))
        }

        [
            face(include_bytes!("../assets/fonts/Inter-Regular.ttf"), "Inter-Regular"),
            face(include_bytes!("../assets/fonts/Inter-SemiBold.ttf"), "Inter-SemiBold"),
            face(
                include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf"),
                "JetBrainsMono-Regular",
            ),
            face(
                include_bytes!("../assets/fonts/JetBrainsMono-SemiBold.ttf"),
                "JetBrainsMono-SemiBold",
            ),
            face(include_bytes!("../assets/fonts/NotoSansSC-Regular.ttf"), "NotoSansSC-Regular"),
            face(include_bytes!("../assets/fonts/NotoSansSC-Bold.ttf"), "NotoSansSC-Bold"),
        ]
    })
}

fn user_fonts() -> &'static RwLock<HashMap<String, FontArc>> {
    USER_FONTS.get_or_init(|| RwLock::new(HashMap::new()))
}

/// 注册（或覆盖）用户字体。`bytes` 必须是 ttf/otf。
pub fn register_user_font(id: &str, bytes: &[u8]) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("字体 id 不能为空".to_string());
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("字体文件超过 8 MB，已拒绝".to_string());
    }
    let font =
        FontArc::try_from_vec(bytes.to_vec()).map_err(|err| format!("字体解析失败：{err}"))?;
    let mut guard = user_fonts().write().map_err(|_| "字体注册表锁已损坏".to_string())?;
    guard.insert(id.to_string(), font);
    Ok(())
}

/// 移除用户字体（不存在时静默）。
pub fn remove_user_font(id: &str) {
    if let Ok(mut guard) = user_fonts().write() {
        guard.remove(id.trim());
    }
}

/// 已注册字体 id 列表（按 id 排序）。
pub fn user_font_ids() -> Vec<String> {
    let mut ids: Vec<String> =
        user_fonts().read().map(|guard| guard.keys().cloned().collect()).unwrap_or_default();
    ids.sort();
    ids
}

/// 取一份渲染用字体快照（Arc 克隆，开销很小）。
pub fn snapshot() -> FontSet {
    let user = user_fonts()
        .read()
        .map(|guard| guard.iter().map(|(id, font)| (id.clone(), font.clone())).collect())
        .unwrap_or_default();
    FontSet { faces: builtin().clone(), user }
}

impl FontSet {
    pub fn get(&self, face: FaceRef) -> &FontArc {
        match face {
            FaceRef::Builtin(face) => &self.faces[face.index()],
            FaceRef::User(index) => &self.user[index].1,
        }
    }

    fn has_glyph(&self, face: FaceRef, ch: char) -> bool {
        self.get(face).glyph_id(ch).0 != 0
    }

    /// 为一个字符挑选可用字体：自定义字体优先 → family 链 → 内置兜底。
    pub fn resolve(
        &self,
        family: FontFamily,
        weight: u16,
        custom_font: Option<&str>,
        ch: char,
    ) -> FaceRef {
        if let Some(id) = custom_font {
            if let Some(index) = self.user.iter().position(|(font_id, _)| font_id == id) {
                let face = FaceRef::User(index);
                if self.has_glyph(face, ch) {
                    return face;
                }
            }
        }

        use Face::*;
        let bold = weight >= 600;
        let chain: [Face; 3] = match family {
            FontFamily::Sans => {
                if bold {
                    [SansBold, CjkBold, MonoBold]
                } else {
                    [Sans, Cjk, Mono]
                }
            }
            FontFamily::Mono => {
                if bold {
                    [MonoBold, CjkBold, SansBold]
                } else {
                    [Mono, Cjk, Sans]
                }
            }
            FontFamily::Cjk => {
                if bold {
                    [CjkBold, SansBold, MonoBold]
                } else {
                    [Cjk, Sans, Mono]
                }
            }
        };
        for face in chain {
            let reference = FaceRef::Builtin(face);
            if self.has_glyph(reference, ch) {
                return reference;
            }
        }
        FaceRef::Builtin(chain[0])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_fonts_cover_scripts() {
        let fonts = snapshot();
        assert!(fonts.has_glyph(FaceRef::Builtin(Face::Sans), 'A'));
        assert!(fonts.has_glyph(FaceRef::Builtin(Face::Mono), '1'));
        assert!(fonts.has_glyph(FaceRef::Builtin(Face::Cjk), '框'));
        // 拉丁字体没有汉字，必须回退到 Noto。
        assert_eq!(fonts.resolve(FontFamily::Sans, 400, None, '影'), FaceRef::Builtin(Face::Cjk));
    }

    #[test]
    fn user_font_registration_and_resolution() {
        let id = "test-user-font-1";
        let inter = include_bytes!("../assets/fonts/Inter-Regular.ttf");
        register_user_font(id, inter).expect("内置 Inter 应能注册为用户字体");

        let fonts = snapshot();
        assert!(fonts.user.iter().any(|(font_id, _)| font_id == id));
        let index = fonts.user.iter().position(|(font_id, _)| font_id == id).unwrap();
        assert_eq!(fonts.resolve(FontFamily::Mono, 400, Some(id), 'A'), FaceRef::User(index));

        // 未知 id / 非法数据：回退或报错，不 panic。
        assert!(matches!(
            fonts.resolve(FontFamily::Sans, 400, Some("missing-font"), 'A'),
            FaceRef::Builtin(_)
        ));
        assert!(register_user_font("bad", b"not a font").is_err());
        assert!(register_user_font("", inter).is_err());

        remove_user_font(id);
        assert!(!user_font_ids().contains(&id.to_string()));
    }
}
