//! 内嵌字体与字族回退。
//!
//! 字体是 Google Fonts 的子集（OFL 授权，见 `assets/fonts/OFL-*.txt`）：
//! - Inter：拉丁无衬线（机型、水印）
//! - JetBrains Mono：参数行（数字等宽，取景器质感）
//! - Noto Sans SC：中文与兜底
//!
//! 回退策略按「字形覆盖」逐字判断，中英混排不会出现豆腐块。

use std::sync::OnceLock;

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

pub struct FontSet {
    faces: [FontArc; 6],
}

static FONTS: OnceLock<FontSet> = OnceLock::new();

pub fn fonts() -> &'static FontSet {
    FONTS.get_or_init(FontSet::load)
}

impl FontSet {
    fn load() -> Self {
        fn face(bytes: &'static [u8], name: &str) -> FontArc {
            FontArc::try_from_slice(bytes)
                .unwrap_or_else(|err| panic!("内嵌字体 {name} 解析失败：{err}"))
        }

        Self {
            faces: [
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
                face(
                    include_bytes!("../assets/fonts/NotoSansSC-Regular.ttf"),
                    "NotoSansSC-Regular",
                ),
                face(include_bytes!("../assets/fonts/NotoSansSC-Bold.ttf"), "NotoSansSC-Bold"),
            ],
        }
    }

    pub fn get(&self, face: Face) -> &FontArc {
        &self.faces[face.index()]
    }

    fn has_glyph(&self, face: Face, ch: char) -> bool {
        self.get(face).glyph_id(ch).0 != 0
    }

    /// 为一个字符挑选可用字体（family 优先，其次回退）。
    pub fn face_for(&self, family: FontFamily, weight: u16, ch: char) -> Face {
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
            if self.has_glyph(face, ch) {
                return face;
            }
        }
        chain[0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fonts_load_and_cover_scripts() {
        let fonts = fonts();
        assert!(fonts.has_glyph(Face::Sans, 'A'));
        assert!(fonts.has_glyph(Face::Mono, '1'));
        assert!(fonts.has_glyph(Face::Cjk, '框'));
        // 拉丁字体没有汉字，必须回退到 Noto。
        assert_eq!(fonts.face_for(FontFamily::Sans, 400, '影'), Face::Cjk);
        assert_eq!(fonts.face_for(FontFamily::Sans, 700, '影'), Face::CjkBold);
    }
}
