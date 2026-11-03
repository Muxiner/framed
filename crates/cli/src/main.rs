//! 框影 Framed 命令行：`framed render` / `framed probe` / `framed demo`。
//!
//! 原生可执行文件，走同一套 Rust 内核，适合批处理与快速验收。

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use framed_core::config::{Block, FrameTemplate, OutputFormat, RenderConfig};
use framed_core::{decode_config, default_config, probe, render};

const USAGE: &str = r#"框影 Framed — 给照片加上相机取景框

用法:
  framed render <照片> [选项]      渲染一张照片
  framed probe <照片>              输出照片尺寸与 EXIF（JSON）
  framed demo <照片> [--out-dir D] 用全部 5 个模板各渲染一张，便于比较

render 选项:
  -o, --output <路径>        输出文件（默认 <照片名>-framed.png）
  -t, --template <模板>      white | polaroid | film | black | none（默认 white）
  -c, --config <json>        使用自定义 RenderConfig（与 -t 互斥）
      --max-dim <像素>       长边上限（默认保持原图）
      --margin <比例>        边框宽度 / 短边（如 0.045）
      --watermark <文字>     覆盖水印文字（默认取 EXIF 版权/作者）
      --jpeg                 输出 JPEG（默认 PNG）
      --quality <1-100>      JPEG 质量（默认 92）
  -h, --help                 显示帮助
"#;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("错误: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let Some(command) = args.first().map(String::as_str) else {
        print!("{USAGE}");
        return Ok(());
    };
    match command {
        "-h" | "--help" | "help" => {
            print!("{USAGE}");
            Ok(())
        }
        "render" => command_render(&args[1..]),
        "probe" => command_probe(&args[1..]),
        "demo" => command_demo(&args[1..]),
        other => Err(format!("未知命令 `{other}`，运行 framed --help 查看用法")),
    }
}

struct RenderOptions {
    input: PathBuf,
    output: Option<PathBuf>,
    template: FrameTemplate,
    config: Option<PathBuf>,
    max_dim: Option<u32>,
    margin: Option<f32>,
    watermark: Option<String>,
    jpeg: bool,
    quality: Option<u8>,
}

fn command_render(args: &[String]) -> Result<(), String> {
    let options = parse_render_args(args)?;
    let bytes = std::fs::read(&options.input)
        .map_err(|err| format!("读取 {} 失败: {err}", options.input.display()))?;

    let mut config = if let Some(path) = &options.config {
        let json = std::fs::read_to_string(path)
            .map_err(|err| format!("读取配置 {} 失败: {err}", path.display()))?;
        decode_config(&json).map_err(|err| err.to_string())?
    } else {
        let photo = probe(&bytes).map_err(|err| err.to_string())?;
        default_config(&photo, options.template)
    };

    if let Some(margin) = options.margin {
        config.frame.margin = margin.clamp(0.0, 0.3);
    }
    if let Some(max_dim) = options.max_dim {
        config.output.max_dim = max_dim;
    }
    if let Some(quality) = options.quality {
        config.output.quality = quality.min(100);
    }
    if options.jpeg {
        config.output.format = OutputFormat::Jpeg;
    }
    if let Some(watermark) = &options.watermark {
        apply_watermark_override(&mut config, watermark);
    }

    let output = render(&bytes, &config).map_err(|err| err.to_string())?;
    let output_path = options.output.unwrap_or_else(|| {
        let stem = options
            .input
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| "photo".to_string());
        let extension = match config.output.format {
            OutputFormat::Png => "png",
            OutputFormat::Jpeg => "jpg",
        };
        options.input.with_file_name(format!("{stem}-framed.{extension}"))
    });
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("创建目录 {} 失败: {err}", parent.display()))?;
        }
    }
    std::fs::write(&output_path, &output.bytes)
        .map_err(|err| format!("写入 {} 失败: {err}", output_path.display()))?;

    println!(
        "{}  {}×{}  {} KiB  →  {}",
        output.mime,
        output.meta.width,
        output.meta.height,
        output.bytes.len() / 1024,
        output_path.display()
    );
    Ok(())
}

fn parse_render_args(args: &[String]) -> Result<RenderOptions, String> {
    let mut input: Option<PathBuf> = None;
    let mut options = RenderOptions {
        input: PathBuf::new(),
        output: None,
        template: FrameTemplate::White,
        config: None,
        max_dim: None,
        margin: None,
        watermark: None,
        jpeg: false,
        quality: None,
    };

    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        index += 1;
        match arg {
            "-o" | "--output" => options.output = Some(PathBuf::from(next_arg(args, &mut index)?)),
            "-t" | "--template" => {
                options.template = parse_template(&next_arg(args, &mut index)?)?;
            }
            "-c" | "--config" => options.config = Some(PathBuf::from(next_arg(args, &mut index)?)),
            "--max-dim" => {
                options.max_dim = Some(
                    next_arg(args, &mut index)?
                        .parse()
                        .map_err(|_| "--max-dim 需要整数".to_string())?,
                )
            }
            "--margin" => {
                options.margin = Some(
                    next_arg(args, &mut index)?
                        .parse()
                        .map_err(|_| "--margin 需要 0–0.3 的小数".to_string())?,
                )
            }
            "--watermark" => options.watermark = Some(next_arg(args, &mut index)?),
            "--jpeg" => options.jpeg = true,
            "--quality" => {
                options.quality = Some(
                    next_arg(args, &mut index)?
                        .parse()
                        .map_err(|_| "--quality 需要 1–100 整数".to_string())?,
                )
            }
            "-h" | "--help" => {
                print!("{USAGE}");
                std::process::exit(0);
            }
            other if other.starts_with('-') => {
                return Err(format!("未知选项 `{other}`，运行 framed --help 查看用法"))
            }
            other => {
                if input.is_some() {
                    return Err(format!("多余的参数 `{other}`"));
                }
                input = Some(PathBuf::from(other));
            }
        }
    }

    options.input = input.ok_or_else(|| "render 需要一个照片路径".to_string())?;
    Ok(options)
}

fn next_arg(args: &[String], index: &mut usize) -> Result<String, String> {
    let value = args.get(*index).ok_or_else(|| "选项缺少参数".to_string())?.clone();
    *index += 1;
    Ok(value)
}

fn parse_template(value: &str) -> Result<FrameTemplate, String> {
    match value {
        "white" => Ok(FrameTemplate::White),
        "polaroid" => Ok(FrameTemplate::Polaroid),
        "film" => Ok(FrameTemplate::Film),
        "black" => Ok(FrameTemplate::Black),
        "none" => Ok(FrameTemplate::None),
        other => Err(format!("未知模板 `{other}`，可选 white | polaroid | film | black | none")),
    }
}

fn apply_watermark_override(config: &mut RenderConfig, watermark: &str) {
    for block in &mut config.blocks {
        if block.id() != "watermark" {
            continue;
        }
        if let Block::Text(text) = block {
            text.text = watermark.to_string();
        }
    }
}

fn command_probe(args: &[String]) -> Result<(), String> {
    let input = args.first().ok_or_else(|| "probe 需要一个照片路径".to_string())?;
    let bytes = std::fs::read(input).map_err(|err| format!("读取 {input} 失败: {err}"))?;
    let photo = probe(&bytes).map_err(|err| err.to_string())?;
    println!("{}", serde_json::to_string_pretty(&photo).map_err(|err| err.to_string())?);
    Ok(())
}

fn command_demo(args: &[String]) -> Result<(), String> {
    let mut input: Option<PathBuf> = None;
    let mut out_dir = PathBuf::from("framed-demo");
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();
        index += 1;
        match arg {
            "--out-dir" => out_dir = PathBuf::from(next_arg(args, &mut index)?),
            other if other.starts_with('-') => {
                return Err(format!("未知选项 `{other}`，运行 framed --help 查看用法"))
            }
            other => input = Some(PathBuf::from(other)),
        }
    }
    let input = input.ok_or_else(|| "demo 需要一个照片路径".to_string())?;
    let bytes =
        std::fs::read(&input).map_err(|err| format!("读取 {} 失败: {err}", input.display()))?;
    let photo = probe(&bytes).map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&out_dir)
        .map_err(|err| format!("创建目录 {} 失败: {err}", out_dir.display()))?;
    let stem = sanitize_stem(&input);
    for template in [
        FrameTemplate::White,
        FrameTemplate::Polaroid,
        FrameTemplate::Film,
        FrameTemplate::Black,
        FrameTemplate::None,
    ] {
        let mut config = default_config(&photo, template);
        config.output.max_dim = 1800;
        let output = render(&bytes, &config).map_err(|err| err.to_string())?;
        let path = out_dir.join(format!("{stem}-{template:?}.png").to_lowercase());
        std::fs::write(&path, output.bytes)
            .map_err(|err| format!("写入 {} 失败: {err}", path.display()))?;
        println!("{}  →  {}", template_name(template), path.display());
    }
    Ok(())
}

fn sanitize_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "photo".to_string());
    stem.chars()
        .map(|ch| if ch.is_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
        .collect()
}

fn template_name(template: FrameTemplate) -> &'static str {
    match template {
        FrameTemplate::White => "白边",
        FrameTemplate::Polaroid => "拍立得",
        FrameTemplate::Film => "胶片",
        FrameTemplate::Black => "黑框",
        FrameTemplate::None => "无边框",
    }
}
