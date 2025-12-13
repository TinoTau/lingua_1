// 房间管理模块
// 负责房间的创建、加入、退出和成员管理

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use chrono::{DateTime, Utc};
use tracing::{info, warn};

/// 房间成员信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub participant_id: String, // 等同于 session_id
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_lang: Option<String>, // 用于翻译路由
    /// 原声传递偏好设置
    /// key: 其他成员的 session_id, value: 是否接收该成员的原声（true=接收，false=不接收）
    /// 如果 key 不存在，默认值为 true（接收）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_voice_preferences: Option<HashMap<String, bool>>,
    pub joined_at: DateTime<Utc>,
}

/// 房间信息
#[derive(Debug, Clone)]
pub struct Room {
    pub room_code: String, // 6位数字房间码
    pub room_id: String, // 服务器内部唯一 ID
    pub participants: HashMap<String, Participant>, // key: session_id
    pub created_at: DateTime<Utc>,
    pub last_speaking_at: DateTime<Utc>, // 用于房间过期检测
}

impl Room {
    pub fn new(room_code: String, room_id: String) -> Self {
        let now = Utc::now();
        Self {
            room_code,
            room_id,
            participants: HashMap::new(),
            created_at: now,
            last_speaking_at: now,
        }
    }

    /// 添加成员
    pub fn add_participant(&mut self, participant: Participant) {
        self.participants.insert(participant.session_id.clone(), participant);
        self.last_speaking_at = Utc::now(); // 更新最后说话时间
    }

    /// 移除成员
    pub fn remove_participant(&mut self, session_id: &str) -> Option<Participant> {
        self.participants.remove(session_id)
    }

    /// 获取成员列表（用于序列化）
    pub fn get_members(&self) -> Vec<Participant> {
        self.participants.values().cloned().collect()
    }

    /// 检查房间是否为空
    pub fn is_empty(&self) -> bool {
        self.participants.is_empty()
    }

    /// 更新最后说话时间
    pub fn update_last_speaking_at(&mut self) {
        self.last_speaking_at = Utc::now();
    }

    /// 检查房间是否过期（30分钟无人说话）
    pub fn is_expired(&self) -> bool {
        let now = Utc::now();
        let duration = now.signed_duration_since(self.last_speaking_at);
        duration.num_minutes() >= 30
    }
}

/// 房间管理器
#[derive(Clone)]
pub struct RoomManager {
    rooms: Arc<RwLock<HashMap<String, Room>>>, // key: room_code
    room_id_to_code: Arc<RwLock<HashMap<String, String>>>, // room_id -> room_code
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(RwLock::new(HashMap::new())),
            room_id_to_code: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 生成6位数字房间码
    fn generate_room_code() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        format!("{:06}", rng.gen_range(100000..=999999))
    }

    /// 创建房间
    /// 创建者自动成为第一个成员
    /// 返回 (room_code, room_id)
    pub async fn create_room(
        &self,
        creator_session_id: String,
        creator_display_name: Option<String>,
        creator_preferred_lang: Option<String>,
    ) -> (String, String) {
        let mut rooms = self.rooms.write().await;
        let mut room_id_to_code = self.room_id_to_code.write().await;
        
        // 生成房间码（最多重试3次）
        let mut room_code = Self::generate_room_code();
        let mut retries = 0;
        while rooms.contains_key(&room_code) && retries < 3 {
            room_code = Self::generate_room_code();
            retries += 1;
        }
        
        // 如果仍然冲突，使用 UUID 后6位
        if rooms.contains_key(&room_code) {
            let uuid = uuid::Uuid::new_v4();
            room_code = uuid.to_string()[..6].to_string();
        }
        
        let room_id = uuid::Uuid::new_v4().to_string();
        let mut room = Room::new(room_code.clone(), room_id.clone());
        
        // 将创建者添加为第一个成员
        let creator = Participant {
            participant_id: creator_session_id.clone(),
            session_id: creator_session_id.clone(),
            display_name: creator_display_name,
            preferred_lang: creator_preferred_lang,
            raw_voice_preferences: Some(HashMap::new()), // 初始化为空，默认接收所有成员的原声
            joined_at: Utc::now(),
        };
        room.add_participant(creator);
        
        rooms.insert(room_code.clone(), room);
        room_id_to_code.insert(room_id.clone(), room_code.clone());
        
        info!(room_code = %room_code, session_id = %creator_session_id, "房间已创建，创建者已自动加入");
        (room_code, room_id)
    }

    /// 加入房间
    pub async fn join_room(
        &self,
        room_code: &str,
        session_id: String,
        display_name: Option<String>,
        preferred_lang: Option<String>,
    ) -> Result<(), RoomError> {
        let mut rooms = self.rooms.write().await;
        
        let room = rooms.get_mut(room_code)
            .ok_or(RoomError::RoomNotFound)?;
        
        // 检查是否已经在房间中
        if room.participants.contains_key(&session_id) {
            return Err(RoomError::AlreadyInRoom);
        }
        
        let participant = Participant {
            participant_id: session_id.clone(),
            session_id: session_id.clone(),
            display_name,
            preferred_lang,
            raw_voice_preferences: Some(HashMap::new()), // 初始化为空，默认接收所有成员的原声
            joined_at: Utc::now(),
        };
        
        room.add_participant(participant);
        info!(room_code = %room_code, session_id = %session_id, "成员已加入房间");
        
        Ok(())
    }

    /// 退出房间
    pub async fn leave_room(&self, room_code: &str, session_id: &str) -> Result<bool, RoomError> {
        let mut rooms = self.rooms.write().await;
        
        let room = rooms.get_mut(room_code)
            .ok_or(RoomError::RoomNotFound)?;
        
        room.remove_participant(session_id);
        info!(room_code = %room_code, session_id = %session_id, "成员已退出房间");
        
        // 如果房间为空，清理房间
        let is_empty = room.is_empty();
        if is_empty {
            let room_id = room.room_id.clone();
            rooms.remove(room_code);
            
            let mut room_id_to_code = self.room_id_to_code.write().await;
            room_id_to_code.remove(&room_id);
            
            info!(room_code = %room_code, "房间已清理（最后一个成员离开）");
        }
        
        Ok(is_empty)
    }

    /// 获取房间信息
    pub async fn get_room(&self, room_code: &str) -> Option<Room> {
        let rooms = self.rooms.read().await;
        rooms.get(room_code).cloned()
    }

    /// 获取房间成员列表
    pub async fn get_room_members(&self, room_code: &str) -> Option<Vec<Participant>> {
        let rooms = self.rooms.read().await;
        rooms.get(room_code).map(|room| room.get_members())
    }

    /// 根据 session_id 查找房间码
    pub async fn find_room_by_session(&self, session_id: &str) -> Option<String> {
        let rooms = self.rooms.read().await;
        for (room_code, room) in rooms.iter() {
            if room.participants.contains_key(session_id) {
                return Some(room_code.clone());
            }
        }
        None
    }

    /// 获取房间内所有目标语言的成员（用于翻译路由）
    pub async fn get_target_language_members(
        &self,
        room_code: &str,
        target_lang: &str,
        exclude_session_id: Option<&str>, // 排除发送者
    ) -> Vec<Participant> {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(room_code) {
            room.participants
                .values()
                .filter(|p| {
                    // 排除发送者
                    if let Some(exclude_id) = exclude_session_id {
                        if p.session_id == exclude_id {
                            return false;
                        }
                    }
                    // 匹配目标语言
                    p.preferred_lang.as_ref().map_or(false, |lang| lang == target_lang)
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    /// 获取房间内所有不同的目标语言（排除发送者）
    /// 返回 (target_lang, members) 的列表
    pub async fn get_distinct_target_languages(
        &self,
        room_code: &str,
        exclude_session_id: &str, // 排除发送者
    ) -> Vec<(String, Vec<Participant>)> {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(room_code) {
            // 按 preferred_lang 分组
            let mut lang_groups: std::collections::HashMap<String, Vec<Participant>> = std::collections::HashMap::new();
            
            for participant in room.participants.values() {
                // 排除发送者
                if participant.session_id == exclude_session_id {
                    continue;
                }
                
                // 如果成员有 preferred_lang，加入对应语言组
                if let Some(ref lang) = participant.preferred_lang {
                    lang_groups
                        .entry(lang.clone())
                        .or_insert_with(Vec::new)
                        .push(participant.clone());
                }
            }
            
            lang_groups.into_iter().collect()
        } else {
            Vec::new()
        }
    }

    /// 更新房间最后说话时间
    pub async fn update_last_speaking_at(&self, room_code: &str) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(room_code) {
            room.update_last_speaking_at();
        }
    }

    /// 更新成员的原声传递偏好
    pub async fn update_raw_voice_preference(
        &self,
        room_code: &str,
        session_id: &str,
        target_session_id: &str,
        receive_raw_voice: bool,
    ) -> Result<(), RoomError> {
        let mut rooms = self.rooms.write().await;
        let room = rooms.get_mut(room_code)
            .ok_or(RoomError::RoomNotFound)?;
        
        let participant = room.participants.get_mut(session_id)
            .ok_or(RoomError::RoomNotFound)?;
        
        // 初始化偏好设置（如果不存在）
        if participant.raw_voice_preferences.is_none() {
            participant.raw_voice_preferences = Some(HashMap::new());
        }
        
        // 更新偏好
        if let Some(ref mut prefs) = participant.raw_voice_preferences {
            prefs.insert(target_session_id.to_string(), receive_raw_voice);
        }
        
        info!(room_code = %room_code, session_id = %session_id, target_session_id = %target_session_id, receive_raw_voice = receive_raw_voice, "更新原声传递偏好");
        Ok(())
    }

    /// 获取成员是否接收某个成员的原声
    /// 如果偏好未设置，默认返回 true（接收）
    pub async fn should_receive_raw_voice(
        &self,
        room_code: &str,
        receiver_session_id: &str,
        sender_session_id: &str,
    ) -> bool {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(room_code) {
            if let Some(participant) = room.participants.get(receiver_session_id) {
                if let Some(ref prefs) = participant.raw_voice_preferences {
                    // 如果明确设置了偏好，使用设置的值
                    prefs.get(sender_session_id).copied().unwrap_or(true)
                } else {
                    // 如果没有设置偏好，默认接收
                    true
                }
            } else {
                // 接收者不存在，默认不接收
                false
            }
        } else {
            // 房间不存在，默认不接收
            false
        }
    }

    /// 扫描并清理过期房间
    /// 返回 (room_code, members) 列表，用于发送过期消息
    pub async fn cleanup_expired_rooms(&self) -> Vec<(String, Vec<Participant>)> {
        let mut rooms = self.rooms.write().await;
        let mut room_id_to_code = self.room_id_to_code.write().await;
        let mut expired_rooms = Vec::new();
        
        // 先收集过期房间的信息（包括成员列表）
        let mut to_remove = Vec::new();
        for (room_code, room) in rooms.iter() {
            if room.is_expired() {
                let members = room.get_members();
                to_remove.push((room_code.clone(), room.room_id.clone(), members));
            }
        }
        
        // 清理过期房间
        for (room_code, room_id, members) in to_remove {
            rooms.remove(&room_code);
            room_id_to_code.remove(&room_id);
            expired_rooms.push((room_code.clone(), members));
            warn!(room_code = %room_code, "房间已过期并清理");
        }
        
        expired_rooms
    }
}

/// 房间错误类型
#[derive(Debug, Clone)]
pub enum RoomError {
    RoomNotFound,
    AlreadyInRoom,
    InvalidRoomCode,
}

impl std::fmt::Display for RoomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoomError::RoomNotFound => write!(f, "房间不存在"),
            RoomError::AlreadyInRoom => write!(f, "已在房间中"),
            RoomError::InvalidRoomCode => write!(f, "无效的房间码"),
        }
    }
}

impl std::error::Error for RoomError {}

