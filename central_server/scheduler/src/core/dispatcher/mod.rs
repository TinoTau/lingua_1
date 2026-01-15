mod job;
mod dispatcher;
mod job_creation;
mod job_selection;
mod job_management;
mod selection_outcome;

pub use job::{Job, JobStatus};
pub use dispatcher::JobDispatcher;
// SelectionOutcome 是 pub(crate)，只在内部使用，不导出

// 导出 job_creation 模块供测试使用
#[cfg(test)]
pub use job_creation::phase2_redis_lock::LockAcquireResult;

#[cfg(test)]
mod job_creation_test;