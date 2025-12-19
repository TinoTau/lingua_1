//! Utterance Group 管理器
//! 
//! 负责管理 Utterance Group 的生命周期、上下文拼接和裁剪

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, debug, warn};

pub type SessionId = String;
pub type GroupId = String;
pub type TraceId = String;

#[derive(Clone, Debug)]
pub struct GroupPart {
    pub part_index: u64,
    pub trace_id: TraceId,
    #[allow(dead_code)]
    pub utterance_index: u64,
    pub asr_text: String,
    pub translated_text: Option<String>, // 允许为空（NMT 失败场景）
    #[allow(dead_code)]
    pub created_at_ms: u64,
    pub error_code: Option<String>, // 可选：用于诊断
}

#[derive(Clone, Debug)]
pub struct UtteranceGroup {
    #[allow(dead_code)]
    pub group_id: GroupId,
    pub session_id: SessionId,
    #[allow(dead_code)]
    pub created_at_ms: u64,
    pub last_tts_end_at_ms: u64,
    pub next_part_index: u64,
    pub parts: VecDeque<GroupPart>, // 用 VecDeque 便于头部裁剪
    pub is_closed: bool,
}

#[derive(Clone, Debug)]
pub struct GroupConfig {
    pub group_window_ms: u64,
    pub max_parts_per_group: usize,
    pub max_context_length: usize,
}

impl Default for GroupConfig {
    fn default() -> Self {
        Self {
            group_window_ms: 2000, // 默认 2 秒窗口
            max_parts_per_group: 8, // 默认最多 8 个 parts
            max_context_length: 800, // 默认最多 800 字符
        }
    }
}

/// Utterance Group 管理器
#[derive(Clone)]
pub struct GroupManager {
    cfg: GroupConfig,
    active: Arc<RwLock<HashMap<SessionId, GroupId>>>,
    groups: Arc<RwLock<HashMap<GroupId, UtteranceGroup>>>,
}

impl GroupManager {
    /// 创建新的 GroupManager
    pub fn new(cfg: GroupConfig) -> Self {
        Self {
            cfg,
            active: Arc::new(RwLock::new(HashMap::new())),
            groups: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 处理 ASR Final 结果
    /// 
    /// 返回: (group_id, context_text, part_index)
    pub async fn on_asr_final(
        &self,
        session_id: &str,
        trace_id: &str,
        utterance_index: u64,
        asr_text: String,
        now_ms: u64,
    ) -> (GroupId, String, u64) {
        let group_id = self.ensure_target_group(session_id, now_ms).await;
        let mut groups = self.groups.write().await;
        let group = groups.get_mut(&group_id).expect("group must exist");

        let part_index = group.next_part_index;
        group.next_part_index += 1;

        let part = GroupPart {
            part_index,
            trace_id: trace_id.to_string(),
            utterance_index,
            asr_text: asr_text.clone(),
            translated_text: None,
            created_at_ms: now_ms,
            error_code: None,
        };

        group.parts.push_back(part);

        Self::trim_group_parts(&mut *group, &self.cfg);
        let context = Self::build_context(&group.parts, self.cfg.max_context_length);

        info!(
            trace_id = %trace_id,
            session_id = %session_id,
            group_id = %group_id,
            utterance_index = utterance_index,
            part_index = part_index,
            asr_text_len = asr_text.len(),
            context_len = context.len(),
            parts_count = group.parts.len(),
            "ASR Final 处理完成，已添加到 Group"
        );

        (group_id, context, part_index)
    }

    /// 处理 NMT 完成
    pub async fn on_nmt_done(
        &self,
        group_id: &str,
        part_index: u64,
        translated_text: Option<String>,
        error_code: Option<String>,
    ) {
        let mut groups = self.groups.write().await;
        if let Some(group) = groups.get_mut(group_id) {
            if let Some(part) = group.parts.iter_mut().find(|p| p.part_index == part_index) {
                let trace_id = part.trace_id.clone();
                part.translated_text = translated_text.clone();
                part.error_code = error_code.clone();
                
                if let Some(ref error) = error_code {
                    warn!(
                        trace_id = %trace_id,
                        group_id = %group_id,
                        part_index = part_index,
                        error_code = %error,
                        "NMT 处理失败，但 Part 仍保留在 Group 中"
                    );
                } else {
                    debug!(
                        trace_id = %trace_id,
                        group_id = %group_id,
                        part_index = part_index,
                        translated_text_len = translated_text.as_ref().map(|t| t.len()).unwrap_or(0),
                        "NMT 处理完成，已更新 Group Part"
                    );
                }
            } else {
                warn!(
                    group_id = %group_id,
                    part_index = part_index,
                    "NMT 完成时未找到对应的 Part"
                );
            }
        } else {
            warn!(
                group_id = %group_id,
                part_index = part_index,
                "NMT 完成时未找到对应的 Group"
            );
        }
    }

    /// 处理 TTS 播放结束
    pub async fn on_tts_play_ended(&self, group_id: &str, tts_end_ms: u64) {
        let mut groups = self.groups.write().await;
        if let Some(group) = groups.get_mut(group_id) {
            let old_tts_end_ms = group.last_tts_end_at_ms;
            group.last_tts_end_at_ms = tts_end_ms; // Scheduler 权威时间
            
            debug!(
                group_id = %group_id,
                session_id = %group.session_id,
                old_tts_end_ms = old_tts_end_ms,
                new_tts_end_ms = tts_end_ms,
                "TTS 播放结束，已更新 Group last_tts_end_at"
            );
        } else {
            warn!(
                group_id = %group_id,
                "TTS 播放结束时未找到对应的 Group"
            );
        }
    }

    /// 处理 Session 结束
    pub async fn on_session_end(&self, session_id: &str, reason: &str) {
        let active_gid = {
            let active = self.active.read().await;
            active.get(session_id).cloned()
        };

        let active_gid_for_log = active_gid.clone();

        if let Some(ref gid) = active_gid {
            self.close_group(gid, reason).await;
        }

        // 清理：v1.1 建议 Session 结束时释放内存
        let removed_count = {
            let mut groups = self.groups.write().await;
            let count = groups.values().filter(|g| g.session_id == session_id).count();
            groups.retain(|_, g| g.session_id != session_id);
            count
        };

        {
            let mut active = self.active.write().await;
            active.remove(session_id);
        }

        info!(
            session_id = %session_id,
            reason = %reason,
            active_group_id = ?active_gid_for_log,
            removed_groups_count = removed_count,
            "Session 结束，已清理所有相关 Group"
        );
    }

    /// 确保目标 Group 存在且可用
    async fn ensure_target_group(&self, session_id: &str, now_ms: u64) -> GroupId {
        let active_gid = {
            let active = self.active.read().await;
            active.get(session_id).cloned()
        };

        match active_gid {
            None => self.create_new_group(session_id, now_ms).await,
            Some(gid) => {
                let should_new = {
                    let groups = self.groups.read().await;
                    if let Some(g) = groups.get(&gid) {
                        g.is_closed || (now_ms.saturating_sub(g.last_tts_end_at_ms) > self.cfg.group_window_ms)
                    } else {
                        true
                    }
                };

                if should_new {
                    self.close_group(&gid, "window_exceeded_or_closed").await;
                    self.create_new_group(session_id, now_ms).await
                } else {
                    gid
                }
            }
        }
    }

    /// 创建新 Group
    async fn create_new_group(&self, session_id: &str, now_ms: u64) -> GroupId {
        let gid = format!("group_{}_{}", session_id, now_ms);
        let group = UtteranceGroup {
            group_id: gid.clone(),
            session_id: session_id.to_string(),
            created_at_ms: now_ms,
            last_tts_end_at_ms: now_ms, // 初始值：以创建时刻作为锚
            next_part_index: 0,
            parts: VecDeque::new(),
            is_closed: false,
        };

        {
            let mut groups = self.groups.write().await;
            groups.insert(gid.clone(), group);
        }

        {
            let mut active = self.active.write().await;
            active.insert(session_id.to_string(), gid.clone());
        }

        info!(
            session_id = %session_id,
            group_id = %gid,
            created_at_ms = now_ms,
            "创建新的 Utterance Group"
        );

        gid
    }

    /// 关闭 Group
    async fn close_group(&self, group_id: &str, reason: &str) {
        let mut groups = self.groups.write().await;
        if let Some(g) = groups.get_mut(group_id) {
            let parts_count = g.parts.len();
            g.is_closed = true;
            
            debug!(
                group_id = %group_id,
                session_id = %g.session_id,
                reason = %reason,
                parts_count = parts_count,
                "关闭 Utterance Group"
            );
        }
    }

    /// 裁剪 Group Parts
    fn trim_group_parts(group: &mut UtteranceGroup, cfg: &GroupConfig) {
        // Step 1: max_parts_per_group（保留最近）
        while group.parts.len() > cfg.max_parts_per_group {
            group.parts.pop_front();
        }
        // Step 2: max_context_length（按 build_context 估算，超出则继续 pop_front）
        while Self::estimate_context_len(&group.parts) > cfg.max_context_length && !group.parts.is_empty() {
            group.parts.pop_front();
        }
        // Step 3: 最近优先已由 pop_front 实现（保留尾部最近）
    }

    /// 估算上下文长度
    fn estimate_context_len(parts: &VecDeque<GroupPart>) -> usize {
        // 粗略估算：asr_text + translated_text + 分隔符
        parts.iter().map(|p| {
            p.asr_text.len() + p.translated_text.as_ref().map(|t| t.len()).unwrap_or(0) + 8
        }).sum()
    }

    /// 构建上下文文本
    fn build_context(parts: &VecDeque<GroupPart>, max_len: usize) -> String {
        // v1.1：仅使用 ASR Final（可选拼接已译文本作为辅助，但必须固定格式）
        // 推荐格式：User: ... / Target: ...
        let mut buf = String::new();
        for p in parts.iter() {
            let line = format!("User: {}\n", p.asr_text.trim());
            buf.push_str(&line);
            if let Some(t) = &p.translated_text {
                buf.push_str(&format!("Target: {}\n", t.trim()));
            }
        }
        if buf.len() > max_len {
            buf.truncate(max_len);
        }
        buf
    }
}

