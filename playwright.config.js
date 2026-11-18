module.exports = {
  testDir: 'tests',
  timeout: 120000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node tests/serve.js', url: 'http://localhost:4173/tests/engine.html', reuseExistingServer: true },
};
