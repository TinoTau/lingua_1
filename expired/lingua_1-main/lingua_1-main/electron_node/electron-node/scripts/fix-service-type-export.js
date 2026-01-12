// 修复 TypeScript 编译后的 ServiceType 枚举导出问题
// TypeScript 编译器生成的枚举代码有时会导致运行时 ServiceType 为 undefined
const fs = require('fs');
const path = require('path');

const messagesJsPath = path.join(__dirname, '../main/shared/protocols/messages.js');
const nodeAgentJsPath = path.join(__dirname, '../main/electron-node/main/src/agent/node-agent.js');

if (fs.existsSync(messagesJsPath)) {
  let content = fs.readFileSync(messagesJsPath, 'utf8');
  
  // 修复 ServiceType 枚举导出
  // 将: exports.ServiceType = void 0; ... (ServiceType || (exports.ServiceType = ServiceType = {}));
  // 改为: ... (ServiceType = exports.ServiceType || (exports.ServiceType = {}));
  const oldPattern = /exports\.ServiceType = void 0;\s*\/\/ ===== 能力类型与服务状态（type 粒度） =====\s*\/\*\* 服务能力类型 \*\/\s*var ServiceType;\s*\(function \(ServiceType\) \{[^}]+\}\)\(ServiceType \|\| \(exports\.ServiceType = ServiceType = \{\}\)\);/s;
  
  if (oldPattern.test(content)) {
    content = content.replace(
      /exports\.ServiceType = void 0;\s*\/\/ ===== 能力类型与服务状态（type 粒度） =====\s*\/\*\* 服务能力类型 \*\/\s*var ServiceType;\s*\(function \(ServiceType\) \{([^}]+)\}\)\(ServiceType \|\| \(exports\.ServiceType = ServiceType = \{\}\)\);/s,
      '// ===== 能力类型与服务状态（type 粒度） =====\n/** 服务能力类型 */\nvar ServiceType;\n(function (ServiceType) {$1})(ServiceType = exports.ServiceType || (exports.ServiceType = {}));'
    );
    
    fs.writeFileSync(messagesJsPath, content, 'utf8');
    console.log('✓ Fixed ServiceType export in messages.js');
  } else {
    // 尝试更简单的替换
    content = content.replace(
      /exports\.ServiceType = void 0;/,
      '// exports.ServiceType will be set by enum initialization'
    );
    content = content.replace(
      /\)\(ServiceType \|\| \(exports\.ServiceType = ServiceType = \{\}\)\);/,
      ')(ServiceType = exports.ServiceType || (exports.ServiceType = {}));'
    );
    
    fs.writeFileSync(messagesJsPath, content, 'utf8');
    console.log('✓ Fixed ServiceType export in messages.js (simple replacement)');
  }
} else {
  console.warn('⚠ messages.js not found at:', messagesJsPath);
}

// 修复 node-agent.js 中的相对路径导入
if (fs.existsSync(nodeAgentJsPath)) {
  let content = fs.readFileSync(nodeAgentJsPath, 'utf8');
  
  // 将错误的相对路径替换为正确的路径
  // 从 main/electron-node/main/src/agent/ 到 main/shared/protocols/ 需要 ../../../../shared/protocols/messages
  const wrongPath1 = /require\(["']\.\.\/\.\.\/shared\/protocols\/messages["']\)/g;
  const wrongPath2 = /require\(["']\.\.\/\.\.\/\.\.\/shared\/protocols\/messages["']\)/g;
  const wrongPath3 = /require\(["']\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/protocols\/messages["']\)/g;
  const correctPath = "require('../../../../shared/protocols/messages')";
  
  let fixed = false;
  if (wrongPath1.test(content)) {
    content = content.replace(wrongPath1, correctPath);
    fixed = true;
    console.log('✓ Fixed relative path import in node-agent.js (from ../../)');
  } else if (wrongPath2.test(content)) {
    content = content.replace(wrongPath2, correctPath);
    fixed = true;
    console.log('✓ Fixed relative path import in node-agent.js (from ../../../)');
  } else if (wrongPath3.test(content)) {
    content = content.replace(wrongPath3, correctPath);
    fixed = true;
    console.log('✓ Fixed relative path import in node-agent.js (from ../../../../../../)');
  }
  
  if (fixed) {
    fs.writeFileSync(nodeAgentJsPath, content, 'utf8');
  }
} else {
  console.warn('⚠ node-agent.js not found at:', nodeAgentJsPath);
}

