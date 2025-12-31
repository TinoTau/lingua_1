/// EDGE-1: Finalize 类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FinalizeType {
    /// 手动截断（is_final=true）
    Manual,
    /// 自动 finalize（pause/timeout）
    Auto,
    /// 异常保护（MaxLength）
    Exception,
}

impl FinalizeType {
    /// 判断 finalize 类型（自动/手动/异常）
    pub(crate) fn from_reason(reason: &str) -> Self {
        match reason {
            "IsFinal" => FinalizeType::Manual,  // 手动截断
            "Pause" | "Timeout" => FinalizeType::Auto,  // 自动 finalize（静音/超时）
            "MaxLength" => FinalizeType::Exception,  // 异常保护
            _ => FinalizeType::Auto,  // 默认按自动处理
        }
    }
}

