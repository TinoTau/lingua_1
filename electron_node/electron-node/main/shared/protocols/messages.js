"use strict";
// shared/protocols/messages.ts
// WebSocket 消息协议 TypeScript 接口定义（与 docs/PROTOCOLS.md 对应）
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceType = void 0;
// ===== 能力类型与服务状态（type 粒度） =====
/** 服务能力类型 */
var ServiceType;
(function (ServiceType) {
    ServiceType["ASR"] = "asr";
    ServiceType["NMT"] = "nmt";
    ServiceType["TTS"] = "tts";
    ServiceType["TONE"] = "tone";
    ServiceType["SEMANTIC"] = "semantic";
})(ServiceType || (exports.ServiceType = ServiceType = {}));
