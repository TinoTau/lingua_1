use crate::core::AppState;
use crate::messages::NodeMessage;
use axum::extract::ws::Message;
use tokio::sync::mpsc;

mod job_progress;
mod job_result;
mod misc;
mod register;

/// Phase 2: When node connects to A and session connects to B, node->scheduler result messages arrive at A
/// But session, result_queue / job context is on B (session owner)
/// Therefore, forward these NodeMessage to session owner, let owner instance execute "final business processing"
pub(crate) async fn handle_forwarded_node_message(state: &AppState, message: NodeMessage) {
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    let mut node_id: Option<String> = None;
    let _ = handle_node_message(message, state, &mut node_id, &tx).await;
}

// Handle node messages
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
            capability_by_type,
            language_capabilities,
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
                capability_by_type,
                language_capabilities,
            )
            .await
        }

        NodeMessage::NodeHeartbeat {
            node_id: nid,
            timestamp: _,
            resource_usage,
            installed_models,
            installed_services,
            capability_by_type,
            rerun_metrics,
            asr_metrics,
            processing_metrics,
            language_capabilities,
        } => {
            register::handle_node_heartbeat(
                state,
                &nid,
                resource_usage,
                installed_models,
                Some(installed_services),
                capability_by_type,
                rerun_metrics,
                asr_metrics,
                processing_metrics,
                language_capabilities,
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
            node_completed_at_ms,
            // OBS-2: ASR 质量信息
            asr_quality_level,
            reason_codes,
            quality_score,
            rerun_count,
            segments_meta,
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
                node_completed_at_ms,
                // OBS-2: 透传 ASR 质量信息
                asr_quality_level,
                reason_codes,
                quality_score,
                rerun_count,
                segments_meta,
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
