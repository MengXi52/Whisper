/// 对话全流程日志模块
///
/// 将 LLM 对话的每个步骤写入日志文件，方便调试。
/// 日志文件保存在项目根目录的 logs/ 文件夹中，每次启动创建一个新文件。
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// 日志级别
#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

impl LogLevel {
    fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Debug => "DEBUG",
        }
    }
}

/// 日志文件写入器
pub struct ConversationLogger {
    file_path: PathBuf,
}

impl ConversationLogger {
    /// 创建日志器，日志文件位于项目根目录的 logs/ 下
    pub fn new() -> Self {
        // 获取项目根目录（src-tauri 的父目录）
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));

        // 从 exe 路径向上找项目根（包含 src-tauri 目录的父级）
        let project_root = if exe_dir.ends_with("src-tauri") {
            exe_dir.parent().unwrap_or(&exe_dir).to_path_buf()
        } else if exe_dir.ends_with("target") || exe_dir.ancestors().any(|p| p.ends_with("target")) {
            // 开发模式下可能在 target/debug 下，回溯到项目根
            let mut p = exe_dir.clone();
            while !p.join("src-tauri").exists() {
                if !p.pop() {
                    break;
                }
            }
            p
        } else {
            // fallback: 使用当前工作目录
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        };

        let logs_dir = project_root.join("logs");
        fs::create_dir_all(&logs_dir).ok();

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let file_path = logs_dir.join(format!("conversation_{}.log", timestamp));

        // 写入文件头
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .write(true)
            .append(false)
            .open(&file_path)
        {
            let _ = writeln!(
                file,
                "=== Whisper LLM 对话全流程日志 ===\n\
                 启动时间: {}\n\
                 日志文件: {}\n\
                 {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                file_path.display(),
                std::iter::repeat("=").take(50).collect::<String>(),
            );
        }

        eprintln!("[LOGGER] 日志文件: {}", file_path.display());

        Self { file_path }
    }

    /// 写入一条日志
    pub fn log(&self, level: LogLevel, target: &str, message: &str) {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{}] [{}] [{}] {}\n", now, level.as_str(), target, message);

        // 写文件
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(&self.file_path)
        {
            let _ = file.write_all(line.as_bytes());
        }

        // 同时输出到终端
        eprint!("{}", line);
    }

    /// 写入一条带分隔线的日志
    pub fn section(&self, title: &str) {
        let sep = std::iter::repeat("-").take(40).collect::<String>();
        self.log(LogLevel::Info, "SECTION", &format!("\n{}\n[{}]\n{}", sep, title, sep));
    }

    /// 获取日志文件路径
    #[allow(dead_code)]
    pub fn file_path(&self) -> &PathBuf {
        &self.file_path
    }
}

/// 全局日志器实例
static LOGGER: std::sync::LazyLock<ConversationLogger> =
    std::sync::LazyLock::new(|| {
        ConversationLogger::new()
    });

/// 获取全局日志器引用
pub fn get_logger() -> &'static ConversationLogger {
    &LOGGER
}

/// 便捷宏：日志记录
#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)+) => {
        $crate::logger::get_logger().log($crate::logger::LogLevel::Info, $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)+) => {
        $crate::logger::get_logger().log($crate::logger::LogLevel::Debug, $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)+) => {
        $crate::logger::get_logger().log($crate::logger::LogLevel::Warn, $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)+) => {
        $crate::logger::get_logger().log($crate::logger::LogLevel::Error, $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_section {
    ($title:expr) => {
        $crate::logger::get_logger().section($title)
    };
}