/**
 * 测试脚本：模拟注册表读取逻辑
 * 用于调试为什么看不到已安装服务
 */

const fs = require('fs');
const path = require('path');

// 模拟 ServiceRegistryManager 的路径检测逻辑
function findServicesDir() {
    // 获取当前脚本所在目录
    const scriptDir = __dirname;
    console.log('脚本目录:', scriptDir);

    // 检查环境变量
    if (process.env.SERVICES_DIR) {
        console.log('使用环境变量 SERVICES_DIR:', process.env.SERVICES_DIR);
        return process.env.SERVICES_DIR;
    }

    // 开发环境检测
    const isDev = process.env.NODE_ENV === 'development' || !process.env.ELECTRON_IS_PACKAGED;
    console.log('isDev:', isDev);

    if (isDev) {
        // 尝试项目目录（从 electron-node/main 向上三级到 electron_node/services）
        const projectServicesDir = path.join(scriptDir, '../../../services');
        console.log('检查项目目录:', projectServicesDir);
        console.log('  存在:', fs.existsSync(projectServicesDir));

        if (fs.existsSync(projectServicesDir)) {
            console.log('✓ 使用项目目录:', projectServicesDir);
            return projectServicesDir;
        } else {
            // 回退到 userData
            const userData = process.env.APPDATA || process.env.HOME;
            const userDataServices = path.join(userData, 'electron-node/services');
            console.log('回退到 userData:', userDataServices);
            return userDataServices;
        }
    } else {
        const userData = process.env.APPDATA || process.env.HOME;
        const userDataServices = path.join(userData, 'electron-node/services');
        console.log('生产环境，使用 userData:', userDataServices);
        return userDataServices;
    }
}

// 测试路径替换
function replacePathPlaceholders(obj, servicesDir) {
    if (typeof obj === 'string') {
        return obj.replace(/{SERVICES_DIR}/g, servicesDir);
    } else if (Array.isArray(obj)) {
        return obj.map(item => replacePathPlaceholders(item, servicesDir));
    } else if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = replacePathPlaceholders(value, servicesDir);
        }
        return result;
    }
    return obj;
}

// 主测试
console.log('=== 测试服务注册表读取 ===\n');

const servicesDir = findServicesDir();
console.log('\n最终使用的 servicesDir:', servicesDir);
console.log('');

const installedPath = path.join(servicesDir, 'installed.json');
console.log('installed.json 路径:', installedPath);
console.log('文件存在:', fs.existsSync(installedPath));
console.log('');

if (fs.existsSync(installedPath)) {
    try {
        const installedData = fs.readFileSync(installedPath, 'utf-8');
        const parsed = JSON.parse(installedData);

        console.log('✓ JSON 解析成功');
        console.log('原始数据中的服务数量:', Object.keys(parsed).length);
        console.log('服务列表:', Object.keys(parsed).join(', '));
        console.log('');

        // 检查占位符
        const hasPlaceholder = installedData.includes('{SERVICES_DIR}');
        console.log('包含路径占位符:', hasPlaceholder);

        if (hasPlaceholder) {
            const servicesDirNormalized = servicesDir.replace(/\\/g, '/');
            console.log('标准化路径:', servicesDirNormalized);

            const replaced = replacePathPlaceholders(parsed, servicesDirNormalized);
            console.log('✓ 路径替换完成');

            // 验证
            const afterReplace = JSON.stringify(replaced);
            if (afterReplace.includes('{SERVICES_DIR}')) {
                console.log('❌ 警告：替换后仍有占位符！');
            } else {
                console.log('✓ 路径替换验证通过');
            }

            // 列出所有服务
            console.log('\n替换后的服务信息:');
            for (const [serviceId, versions] of Object.entries(replaced)) {
                for (const [versionKey, serviceInfo] of Object.entries(versions)) {
                    console.log(`  ${serviceId} (${serviceInfo.version}, ${serviceInfo.platform})`);
                    console.log(`    安装路径: ${serviceInfo.install_path}`);
                }
            }

            // 模拟 listInstalled
            console.log('\n模拟 listInstalled() 结果:');
            const installed = [];
            for (const [sid, versions] of Object.entries(replaced)) {
                if (!versions) continue;
                for (const versionInfo of Object.values(versions)) {
                    installed.push(versionInfo);
                }
            }
            console.log(`找到 ${installed.length} 个已安装服务`);
            installed.forEach(s => {
                console.log(`  - ${s.service_id} v${s.version} (${s.platform})`);
            });
        } else {
            console.log('✓ 没有路径占位符，数据已正确');
        }
    } catch (error) {
        console.error('❌ 读取失败:', error.message);
        console.error(error.stack);
    }
} else {
    console.log('❌ 文件不存在！');
    console.log('\n请检查:');
    console.log('  1. 文件是否在正确的位置');
    console.log('  2. 路径检测逻辑是否正确');
}

