// Session message handler module (split version)

mod audio;
mod core;
mod room;
mod utterance;
mod webrtc;

use crate::core::AppState;
use crate::messages::SessionMessage;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::warn;

/// Handle session messages
pub(crate) async fn handle_session_message(
    message: SessionMessage,
    state: &AppState,
    session_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
) -> Result<(), anyhow::Error> {
    match message {
        SessionMessage::SessionInit {
            client_version,
            platform,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pairing_code,
            tenant_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id,
        } => {
            core::handle_session_init(
                state,
                session_id,
                tx,
                client_version,
                platform,
                src_lang,
                tgt_lang,
                dialect,
                features,
                pairing_code,
                tenant_id,
                mode,
                lang_a,
                lang_b,
                auto_langs,
                trace_id,
            )
            .await?;
        }

        SessionMessage::AudioChunk {
            session_id: sess_id,
            seq: _,
            is_final,
            payload,
            client_timestamp_ms,
        } => {
            audio::handle_audio_chunk(state, tx, sess_id, is_final, payload, client_timestamp_ms).await?;
        }

        SessionMessage::Utterance {
            session_id: sess_id,
            utterance_index,
            manual_cut,
            src_lang,
            tgt_lang,
            dialect,
            features,
            audio,
            audio_format,
            sample_rate,
            mode: _,
            lang_a: _,
            lang_b: _,
            auto_langs: _,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id: utterance_trace_id,
            pipeline,
        } => {
            utterance::handle_utterance(
                state,
                tx,
                sess_id,
                utterance_index,
                manual_cut,
                src_lang,
                tgt_lang,
                dialect,
                features,
                audio,
                audio_format,
                sample_rate,
                utterance_trace_id,
                pipeline,
            )
            .await?;
        }

        SessionMessage::ClientHeartbeat {
            session_id: sess_id,
            timestamp: _,
        } => {
            core::handle_client_heartbeat(state, tx, sess_id).await?;
        }

        SessionMessage::TtsStarted {
            session_id: sess_id,
            trace_id: _,
            group_id,
            ts_start_ms,
        } => {
            core::handle_tts_started(state, sess_id, group_id, ts_start_ms).await;
        }

        SessionMessage::TtsPlayEnded {
            session_id: sess_id,
            trace_id: _,
            group_id,
            ts_end_ms,
        } => {
            core::handle_tts_play_ended(state, sess_id, group_id, ts_end_ms).await;
        }

        SessionMessage::SessionClose {
            session_id: sess_id,
            reason,
        } => {
            core::handle_session_close(state, tx, sess_id, reason).await?;
        }

        // ===== Room-related message handling =====
        SessionMessage::RoomCreate {
            client_ts: _,
            display_name,
            preferred_lang,
        } => {
            room::handle_room_create(state, tx, session_id, display_name, preferred_lang).await?;
        }

        SessionMessage::RoomJoin {
            room_code,
            display_name,
            preferred_lang,
        } => {
            room::handle_room_join(state, tx, session_id, room_code, display_name, preferred_lang)
                .await?;
        }

        SessionMessage::RoomLeave { room_code } => {
            room::handle_room_leave(state, tx, session_id, room_code).await?;
        }

        SessionMessage::RoomRawVoicePreference {
            room_code,
            target_session_id,
            receive_raw_voice,
        } => {
            room::handle_room_raw_voice_preference(
                state,
                tx,
                session_id,
                room_code,
                target_session_id,
                receive_raw_voice,
            )
            .await?;
        }

        // ===== WebRTC signaling message handling =====
        SessionMessage::WebRTCOffer { room_code, to, sdp } => {
            webrtc::handle_webrtc_offer(state, session_id, room_code, to, sdp).await?;
        }

        SessionMessage::WebRTCAnswer { room_code, to, sdp } => {
            webrtc::handle_webrtc_answer(state, session_id, room_code, to, sdp).await?;
        }

        SessionMessage::WebRTCIce {
            room_code,
            to,
            candidate,
        } => {
            webrtc::handle_webrtc_ice(state, session_id, room_code, to, candidate).await?;
        }

        _ => {
            warn!("Received unhandled session message type");
        }
    }

    Ok(())
}
