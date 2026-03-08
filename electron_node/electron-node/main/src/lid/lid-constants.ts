/**
 * LID v1 冻结参数（与 Face2Face FullSpec / Task List 一致）
 * Sherpa-ONNX 子进程调用，超时需覆盖 Python + Whisper 推理时间。
 */

export const LID_TIMEOUT_MS = 15000;
export const LID_WINDOW_MS = 1000;

export const SHORT_UTT_MS = 700;
export const TH_STRONG = 0.80;
export const TH_WEAK = 0.60;
export const CONFIRM_SWITCH_N = 2;
export const SWITCH_MIN_INTERVAL_MS = 1500;

export const ROOM_STATE_TTL_SEC = 600;
