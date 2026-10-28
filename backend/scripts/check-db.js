import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/oracle.js';
import { publicError } from '../src/errors.js';

let database;
try {
  database = createDatabase(loadConfig());
  await database.init();
  const status = await database.schemaStatus();
  console.log('Oracle connection verified.');
  console.table(status);
} catch (error) {
  console.error('Connection check failed:', error.errorNum || error.code || error.message);
  if (error.errorNum || error.code) console.error(publicError(error).message);
  process.exitCode = 1;
} finally {
  try { await database?.close(); } catch { process.exitCode = 1; }
}
