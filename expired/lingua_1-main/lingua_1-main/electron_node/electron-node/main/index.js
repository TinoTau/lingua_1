// Entry point for Electron main process
// 注册路径别名，解决 @shared 路径解析问题
const path = require('path');
const moduleAlias = require('module-alias');

// 注册 @shared 路径别名
const projectRoot = path.resolve(__dirname, '../..');
const sharedPath = path.join(projectRoot, 'shared');
moduleAlias.addAlias('@shared', sharedPath);

// 清除可能已缓存的 @shared 模块，确保使用最新代码
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
        const aliasPath = request.replace('@shared/', path.join(sharedPath, ''));
        const resolved = path.resolve(aliasPath);
        delete require.cache[resolved];
    }
    return originalResolveFilename.apply(this, arguments);
};

// This file redirects to the actual compiled file
module.exports = require('./electron-node/main/src/index.js');

