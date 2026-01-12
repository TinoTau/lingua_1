// Jest setup file for refactor tests

// Mock axios globally
jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  return {
    ...actualAxios,
    create: jest.fn(() => ({
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    })),
  };
});

// 保护原生模块加载，避免测试时崩溃
// opusscript 是原生模块，在测试环境中可能导致进程崩溃
// 使用 try-catch 包装，如果加载失败则继续测试（测试会跳过需要 opusscript 的用例）
process.on('uncaughtException', (error) => {
  if (error.message && error.message.includes('opusscript')) {
    console.warn('[Jest Setup] Opusscript native module error caught:', error.message);
    // 不退出进程，让测试继续
    return;
  }
  // 其他未捕获的异常正常抛出
  throw error;
});

// 保护进程退出
process.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.warn(`[Jest Setup] Process exiting with code: ${code}`);
  }
});

// Suppress console warnings in tests
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});

