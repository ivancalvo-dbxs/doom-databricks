let cached;
let pending;

export async function getToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (pending) return pending;
  pending = (async () => {
    const { DATABRICKS_HOST: host, DATABRICKS_CLIENT_ID: id, DATABRICKS_CLIENT_SECRET: secret } = process.env;
    if (!host || !id || !secret) throw Error('Missing Databricks OAuth configuration');
    const response = await fetch(`${host.replace(/\/$/, '')}/oidc/v1/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'ai-functions' }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw Error(`OAuth HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw Error('Invalid OAuth response');
    cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cached.token;
  })();
  try { return await pending; } finally { pending = undefined; }
}
