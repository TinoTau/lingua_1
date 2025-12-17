// Jest setup file for stage 3.2 tests

// Mock Electron app if not already mocked
if (!global.electronAppMocked) {
  jest.mock('electron', () => ({
    app: {
      getPath: jest.fn((name) => {
        if (name === 'userData') {
          return require('os').tmpdir();
        }
        return '';
      }),
    },
  }));
  global.electronAppMocked = true;
}

