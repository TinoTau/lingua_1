/**
 * 注册 TypeScript 路径别名（@shared/*）
 * 必须在其他模块加载前执行，故由 index 最先 require。
 */
const tsConfigPaths = require('tsconfig-paths');
const pathModule = require('path');

const baseUrl = pathModule.resolve(__dirname, '../..');
tsConfigPaths.register({
  baseUrl,
  paths: { '@shared/*': ['../shared/*'] },
});
console.log('✅ TypeScript path aliases registered (baseUrl:', baseUrl + ')');
