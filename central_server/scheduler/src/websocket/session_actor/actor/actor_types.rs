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
    /// 判断 finalize 类型（自动/手动/异常）
    pub(crate) fn from_reason(reason: &str) -> Self {
        match reason {
            "IsFinal" => FinalizeType::Manual,  // 手动截断
            "Timeout" => FinalizeType::Auto,    // 自动 finalize（超时）
            "MaxDuration" => FinalizeType::Auto,  // 超长语音自动截断，节点端会重新拼接（正常业务逻辑）
            "MaxLength" => FinalizeType::Exception,    // 异常保护（500KB限制，正常情况下不应该触发）
            _ => FinalizeType::Auto,
        }
    }
}

