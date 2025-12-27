/**
 * 服务名称到服务ID的映射工具
 * 统一管理 Python 服务名称到服务ID的转换逻辑
 */

/**
 * Python 服务名称到服务ID的映射
 */
export const SERVICE_NAME_TO_ID_MAP: Record<string, string> = {
    nmt: 'nmt-m2m100',
    tts: 'piper-tts',
    yourtts: 'your-tts',
    speaker_embedding: 'speaker-embedding',
    faster_whisper_vad: 'faster-whisper-vad',
};

/**
 * 从 Python 服务名称获取服务ID
 * @param serviceName Python 服务名称（如 'nmt', 'tts', 'faster_whisper_vad' 等）
 * @returns 服务ID（如 'nmt-m2m100', 'piper-tts', 'faster-whisper-vad' 等）
 */
export function getServiceIdFromPythonName(serviceName: string): string {
    return SERVICE_NAME_TO_ID_MAP[serviceName] || serviceName;
}

/**
 * 从服务ID获取 Python 服务名称（反向映射）
 * @param serviceId 服务ID（如 'nmt-m2m100', 'piper-tts' 等）
 * @returns Python 服务名称（如 'nmt', 'tts' 等），如果找不到则返回原值
 */
export function getPythonNameFromServiceId(serviceId: string): string {
    const reverseMap: Record<string, string> = {};
    for (const [name, id] of Object.entries(SERVICE_NAME_TO_ID_MAP)) {
        reverseMap[id] = name;
    }
    return reverseMap[serviceId] || serviceId;
}

