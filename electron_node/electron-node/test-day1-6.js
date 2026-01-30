/**
 * Day 1-6 重构运行时测试脚本
 * 
 * 在 Electron DevTools Console 中运行此脚本
 * 或者复制粘贴到 Console 中执行
 */

async function testDay1To6() {
  console.log('🧪 开始 Day 1-6 重构测试...\n');
  
  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  // ========================================
  // 测试 1: 环境检查
  // ========================================
  console.log('📋 测试 1: 环境检查');
  try {
    if (!window.electronAPI) {
      throw new Error('window.electronAPI 未定义');
    }
    if (!window.electronAPI.serviceDiscovery) {
      throw new Error('serviceDiscovery API 未定义');
    }
    results.passed.push('环境检查 - electronAPI 正常');
    console.log('  ✅ electronAPI 正常\n');
  } catch (err) {
    results.failed.push(`环境检查失败: ${err.message}`);
    console.error('  ❌ 失败:', err.message, '\n');
    return results; // 无法继续测试
  }

  // ========================================
  // 测试 2: Day 4 - 服务发现
  // ========================================
  console.log('📋 测试 2: Day 4 - 服务发现');
  try {
    const services = await window.electronAPI.serviceDiscovery.list();
    console.log(`  发现 ${services.length} 个服务`);
    
    if (services.length === 0) {
      results.warnings.push('未发现任何服务');
      console.warn('  ⚠️ 未发现任何服务\n');
    } else {
      // 检查所有服务 ID 是否为 kebab-case (Day 5 要求)
      const invalidIds = services.filter(s => s.id.includes('_'));
      if (invalidIds.length > 0) {
        results.failed.push(`发现非 kebab-case 的服务 ID: ${invalidIds.map(s => s.id).join(', ')}`);
        console.error('  ❌ 发现非 kebab-case 的服务 ID:', invalidIds.map(s => s.id));
      } else {
        results.passed.push(`Day 4 & 5 - 发现 ${services.length} 个服务，所有 ID 都是 kebab-case`);
        console.log('  ✅ 所有服务 ID 都是 kebab-case');
      }
      
      console.log('  服务列表:');
      services.forEach(s => {
        console.log(`    - ${s.id} (${s.status})`);
      });
      console.log('');
    }
  } catch (err) {
    results.failed.push(`服务发现失败: ${err.message}`);
    console.error('  ❌ 失败:', err.message, '\n');
  }

  // ========================================
  // 测试 3: Day 5 - IPC Handlers
  // ========================================
  console.log('📋 测试 3: Day 5 - IPC Handlers');
  try {
    // 测试系统资源 API
    const sysRes = await window.electronAPI.getSystemResources();
    console.log('  ✅ getSystemResources 正常');
    
    // 测试节点信息 API
    const nodeInfo = await window.electronAPI.getNodeInfo();
    console.log('  ✅ getNodeInfo 正常');
    console.log(`    节点 ID: ${nodeInfo.id}`);
    
    results.passed.push('Day 5 - IPC handlers 正常工作');
    console.log('');
  } catch (err) {
    results.failed.push(`IPC handlers 测试失败: ${err.message}`);
    console.error('  ❌ 失败:', err.message, '\n');
  }

  // ========================================
  // 测试 4: 服务启动/停止（可选，需要服务存在）
  // ========================================
  console.log('📋 测试 4: 服务启动/停止（选择第一个 stopped 服务）');
  try {
    const services = await window.electronAPI.serviceDiscovery.list();
    const stoppedService = services.find(s => s.status === 'stopped');
    
    if (!stoppedService) {
      results.warnings.push('没有停止的服务可供测试启动功能');
      console.warn('  ⚠️ 没有停止的服务可供测试\n');
    } else {
      console.log(`  尝试启动服务: ${stoppedService.id}`);
      const startResult = await window.electronAPI.serviceDiscovery.start(stoppedService.id);
      
      if (startResult.success) {
        console.log('  ✅ 服务启动成功');
        
        // 等待 2 秒后检查状态
        await new Promise(resolve => setTimeout(resolve, 2000));
        const updatedServices = await window.electronAPI.serviceDiscovery.list();
        const service = updatedServices.find(s => s.id === stoppedService.id);
        
        console.log(`  当前状态: ${service?.status}`);
        
        // 尝试停止服务
        console.log(`  尝试停止服务: ${stoppedService.id}`);
        const stopResult = await window.electronAPI.serviceDiscovery.stop(stoppedService.id);
        
        if (stopResult.success) {
          console.log('  ✅ 服务停止成功');
          results.passed.push('服务启动/停止功能正常');
        } else {
          results.failed.push(`服务停止失败: ${stopResult.error}`);
          console.error('  ❌ 服务停止失败:', stopResult.error);
        }
      } else {
        results.failed.push(`服务启动失败: ${startResult.error}`);
        console.error('  ❌ 服务启动失败:', startResult.error);
      }
      console.log('');
    }
  } catch (err) {
    results.warnings.push(`服务启动/停止测试异常: ${err.message}`);
    console.warn('  ⚠️ 测试异常:', err.message, '\n');
  }

  // ========================================
  // 测试总结
  // ========================================
  console.log('========================================');
  console.log('📊 测试总结');
  console.log('========================================');
  console.log(`✅ 通过: ${results.passed.length} 项`);
  results.passed.forEach(p => console.log(`  - ${p}`));
  
  if (results.warnings.length > 0) {
    console.log(`\n⚠️ 警告: ${results.warnings.length} 项`);
    results.warnings.forEach(w => console.log(`  - ${w}`));
  }
  
  if (results.failed.length > 0) {
    console.log(`\n❌ 失败: ${results.failed.length} 项`);
    results.failed.forEach(f => console.log(`  - ${f}`));
  }
  
  console.log('\n========================================');
  const allPassed = results.failed.length === 0;
  if (allPassed) {
    console.log('🎉 所有测试通过！Day 1-6 重构成功！');
  } else {
    console.log('⚠️ 部分测试失败，请检查上述错误');
  }
  console.log('========================================\n');
  
  return results;
}

// 自动运行测试
console.log('🚀 准备运行 Day 1-6 测试脚本...');
console.log('如需手动运行，请在 Console 中执行: testDay1To6()');
console.log('');

// 延迟 1 秒后自动运行，给用户时间看到提示
setTimeout(() => {
  testDay1To6();
}, 1000);
