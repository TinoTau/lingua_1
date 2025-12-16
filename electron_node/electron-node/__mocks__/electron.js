// Mock Electron for testing
module.exports = {
  app: {
    getPath: (name) => {
      if (name === 'userData') {
        return require('os').tmpdir();
      }
      return '';
    },
  },
};

