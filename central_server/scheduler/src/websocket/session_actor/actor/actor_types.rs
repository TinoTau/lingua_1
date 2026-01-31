/// EDGE-1: Finalize 类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FinalizeType {
    /// 手动截断（is_final=true）
    Manual,
    /// 自动 finalize（timeout/MaxDuration）
    Auto,
    /// 异常保护（MaxLength）
    Exception,
}

impl FinalizeType {
    /// 判断 finalize 类型。调度器只产生 3 种 finalize：手动、Timeout、MaxDuration。
    pub(crate) fn from_reason(reason: &str) -> Self {
        match reason {
            "IsFinal" => FinalizeType::Manual,        // 手动 finalize
            "Timeout" => FinalizeType::Auto,         // Timeout finalize（定时器或间隔>pause_ms）
            "MaxDuration" => FinalizeType::Auto,     // MaxDuration finalize
            "MaxLength" => FinalizeType::Exception,  // 异常保护（500KB）
            "SessionClose" => FinalizeType::Auto,    // 会话关闭时 flush，按 Auto 处理
            _ => FinalizeType::Auto,
        }
    }
}

