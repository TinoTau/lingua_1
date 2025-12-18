use crate::app_state::AppState;
use crate::messages::NodeMessage;
use axum::extract::ws::Message;
use tokio::sync::mpsc;

mod job_progress;
mod job_result;
mod misc;
mod register;

/// Phase 2：当 node 连接在 A、session 连接在 B 时，node->scheduler 的结果消息会到达 A。
/// 但 session 的 result_queue / job 上下文在 B（session owner）上。
/// 因此需要将这些 NodeMessage 转发到 session owner，让 owner 实例执行“最终业务处理”。
pub(crate) async fn handle_forwarded_node_message(state: &AppState, message: NodeMessage) {
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    let mut node_id: Option<String> = None;
    let _ = handle_node_message(message, state, &mut node_id, &tx).await;
}

// 处理节点消息
pub(super) async fn handle_node_message(
    message: NodeMessage,
    state: &AppState,
    node_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
) -> Result<(), anyhow::Error> {
    match message {
        NodeMessage::NodeRegister {
            node_id: provided_node_id,
            version,
            capability_schema_version,
            platform,
            hardware,
            installed_models,
            installed_services,
            features_supported,
            advanced_features: _,
            accept_public_jobs,
            capability_state,
        } => {
            register::handle_node_register(
                state,
                node_id,
                tx,
                provided_node_id,
                version,
                capability_schema_version,
                platform,
                hardware,
                installed_models,
                installed_services,
                features_supported,
                accept_public_jobs,
                capability_state,
            )
            .await
        }

        NodeMessage::NodeHeartbeat {
            node_id: nid,
            timestamp: _,
            resource_usage,
            installed_models,
            installed_services,
            capability_state,
        } => {
            register::handle_node_heartbeat(
                state,
                &nid,
                resource_usage,
                installed_models,
                installed_services,
                capability_state,
            )
            .await;
            Ok(())
        }

        NodeMessage::JobResult {
            job_id,
            attempt_id,
            node_id: nid,
            session_id,
            utterance_index,
            success,
            text_asr,
            text_translated,
            tts_audio,
            tts_format,
            extra,
            processing_time_ms,
            error,
            trace_id,
            group_id,
            part_index,
        } => {
            job_result::handle_job_result(
                state,
                job_id,
                attempt_id,
                nid,
                session_id,
                utterance_index,
                success,
                text_asr,
                text_translated,
                tts_audio,
                tts_format,
                extra,
                processing_time_ms,
                error,
                trace_id,
                group_id,
                part_index,
            )
            .await;
            Ok(())
        }

        NodeMessage::JobAck {
            job_id,
            attempt_id,
            node_id: nid,
            session_id,
            trace_id,
        } => {
            job_progress::handle_job_ack(state, job_id, attempt_id, nid, session_id, trace_id).await;
            Ok(())
        }

        NodeMessage::JobStarted {
            job_id,
            attempt_id,
            node_id: nid,
            session_id,
            trace_id,
        } => {
            job_progress::handle_job_started(state, job_id, attempt_id, nid, session_id, trace_id).await;
            Ok(())
        }

        NodeMessage::AsrPartial {
            job_id,
            node_id: nid,
            session_id,
            utterance_index,
            text,
            is_final,
            trace_id,
        } => {
            job_progress::handle_asr_partial(
                state,
                job_id,
                nid,
                session_id,
                utterance_index,
                text,
                is_final,
                trace_id,
            )
            .await;
            Ok(())
        }

        NodeMessage::NodeError {
            node_id: nid,
            code,
            message,
            details,
        } => {
            misc::handle_node_error(&nid, &code, &message, details).await;
            Ok(())
        }

        other => {
            misc::handle_unhandled(other).await;
            Ok(())
        }
    }
}


