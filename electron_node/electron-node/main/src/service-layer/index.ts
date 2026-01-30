/**
 * Service Layer Entry Point
 * 统一导出所有服务层模块
 * 
 * Day 4: 移除 NodeServiceSupervisor，统一使用 ServiceProcessRunner
 */

export { initServiceLayer, registerServiceIpcHandlers, getServiceRunner } from './service-ipc-handlers';
export { ServiceProcessRunner } from './ServiceProcessRunner';
export { ServiceEndpointResolver } from './ServiceEndpointResolver';
export { getServiceRegistry, setServiceRegistry } from './ServiceRegistrySingleton';
export * from './ServiceTypes';
export * from './ServiceDiscovery';
export * from './ServiceSnapshots';
