mod job_result_deduplication;
mod job_result_routing;
mod job_result_job_management;
mod job_result_group;
mod job_result_events;
mod job_result_metrics;
mod job_result_creation;
mod job_result_sending;
mod job_result_error;
mod job_result_processing;

pub(crate) use job_result_processing::handle_job_result;

