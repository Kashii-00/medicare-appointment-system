export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (!env.DB_PASSWORD || env.DB_PASSWORD === 'YOUR_MEDICARE_PASSWORD') {
    throw new Error('Set DB_PASSWORD in backend/.env to the MEDICARE account password.');
  }
  const origins = (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGINS must contain valid origins.'); }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('CORS_ORIGINS must contain origins without paths or trailing slashes.');
    }
  }
  return {
    host: '127.0.0.1', port, origins, timezone: 'Asia/Colombo',
    user: env.DB_USER || 'MEDICARE', password: env.DB_PASSWORD,
    connectString: env.DB_CONNECT_STRING || '127.0.0.1:1521/FREEPDB1'
  };
}
