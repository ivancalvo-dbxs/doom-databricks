export default {
  testDir: 'tests',
  timeout: 120000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    { command: 'node tests/serve.js', url: 'http://localhost:4173/tests/engine.html', reuseExistingServer: true },
    // The real server, so tests/app.spec.js exercises the page exactly as deployed (/api/* is mocked per test).
    { command: 'DATABRICKS_APP_PORT=4174 node server/app.js', url: 'http://localhost:4174/healthz', reuseExistingServer: true },
  ],
};
