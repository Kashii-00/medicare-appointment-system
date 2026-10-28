import { loadConfig } from './config.js';
import { createDatabase } from './oracle.js';
import { createService } from './service.js';
import { createApp } from './app.js';
import { publicError } from './errors.js';

let database;
try {
  const config = loadConfig();
  database = createDatabase(config);
  await database.init();
  const status = await database.schemaStatus();
  const app = createApp(createService(database), { origins: config.origins });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Oracle connected: ${status.username}/${status.database_name} (Thin mode: ${status.thin_mode}).`);
    console.log(`MediCare API running at http://${config.host}:${config.port}`);
    console.log(`Health check: http://${config.host}:${config.port}/api/health`);
  });
  server.on('error', async error => {
    console.error(error.code === 'EADDRINUSE' ? 'The backend port is already in use. Change PORT in .env.' : 'The HTTP server could not start.');
    await database.close();
    process.exitCode = 1;
  });
  let stopping = false;
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping MediCare API...');
    const timer = setTimeout(() => process.exit(1), 20000);
    timer.unref();
    server.close(async () => {
      try { await database.close(); clearTimeout(timer); process.exit(0); }
      catch { process.exit(1); }
    });
  });
} catch (error) {
  console.error('Backend startup failed:', error.errorNum || error.code || error.message);
  if (error.errorNum || error.code) console.error(publicError(error).message);
  try { await database?.close(); } catch { /* preserve the startup error */ }
  process.exitCode = 1;
}
