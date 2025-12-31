"use strict";
/**
 * Task Router Service Selector
 * 处理服务选择相关的逻辑
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterServiceSelector = void 0;
class TaskRouterServiceSelector {
    constructor() {
        this.roundRobinIndex = new Map();
    }
    /**
     * 选择服务端点
     */
    selectServiceEndpoint(serviceType, serviceEndpoints, selectionStrategy = 'round_robin') {
        const endpoints = serviceEndpoints.get(serviceType) || [];
        if (endpoints.length === 0) {
            return null;
        }
        if (selectionStrategy === 'round_robin') {
            const currentIndex = this.roundRobinIndex.get(serviceType) || 0;
            const selected = endpoints[currentIndex % endpoints.length];
            this.roundRobinIndex.set(serviceType, (currentIndex + 1) % endpoints.length);
            return selected;
        }
        // 默认返回第一个
        return endpoints[0];
    }
}
exports.TaskRouterServiceSelector = TaskRouterServiceSelector;
