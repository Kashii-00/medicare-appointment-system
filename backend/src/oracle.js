import oracledb from 'oracledb';
import { normalizeRows } from './serialization.js';

export function createDatabase(config, { driver = oracledb, logger = console } = {}) {
  let pool;
  // Oracle DATE/TIMESTAMP values have clinic-local semantics in this schema.
  // node-oracledb materializes them in the application timezone; JSON timestamps
  // are subsequently emitted as UTC ISO strings by normalizeRows().
  process.env.TZ = config.timezone;
  driver.outFormat = driver.OUT_FORMAT_OBJECT;
  driver.fetchAsString = [driver.CLOB];

  async function init() {
    pool = await driver.createPool({
      user: config.user, password: config.password, connectString: config.connectString,
      poolMin: 1, poolMax: 4, poolIncrement: 1, queueTimeout: 10000, stmtCacheSize: 40,
      sessionCallback(connection, _tag, done) {
        connection.execute("ALTER SESSION SET TIME_ZONE = 'Asia/Colombo'")
          .then(() => done(null, connection), done);
      }
    });
  }

  async function use(work, write) {
    if (!pool) throw new Error('Oracle pool has not been initialized.');
    const connection = await pool.getConnection();
    connection.callTimeout = 15000;
    try {
      const result = await work(connection);
      if (write) await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); }
      catch (rollbackError) { logger.error('Oracle rollback failed:', rollbackError.code || rollbackError.errorNum || 'UNKNOWN'); }
      throw error;
    } finally {
      try { await connection.close(); }
      catch (closeError) { logger.error('Oracle connection release failed:', closeError.code || closeError.errorNum || 'UNKNOWN'); }
    }
  }

  async function schemaStatus() {
    return use(async connection => {
      const context = normalizeRows((await connection.execute(`
        SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS username,
               SYS_CONTEXT('USERENV','CON_NAME') AS database_name FROM dual`)).rows)[0];
      if (context.username !== 'MEDICARE' || context.database_name !== 'FREEPDB1') {
        throw new Error('The backend must connect as MEDICARE to FREEPDB1.');
      }
      const objects = normalizeRows((await connection.execute(`
        SELECT object_name,object_type,status FROM user_objects
        WHERE object_name IN ('MC_API','MC_REPORTS','V_APPOINTMENT_DETAILS',
          'V_APPOINTMENT_BALANCES','TRG_PATIENTS_VALIDATE','TRG_DOCTORS_VALIDATE',
          'TRG_SESSIONS_HISTORY','TRG_APPOINTMENTS_HISTORY','TRG_PAYMENTS_HISTORY')
        ORDER BY object_name,object_type`)).rows);
      if (objects.length !== 11 || objects.some(object => object.status !== 'VALID')) {
        throw new Error('Stage 2 database objects are missing or invalid. Recheck script 02.');
      }
      const counts = normalizeRows((await connection.execute(`
        SELECT (SELECT COUNT(*) FROM doctors) AS doctors,
               (SELECT COUNT(*) FROM patients) AS patients,
               (SELECT COUNT(*) FROM appointments) AS appointments FROM dual`)).rows)[0];
      return { ...context, ...counts, program_objects: objects.length, thin_mode: driver.thin };
    }, false);
  }

  return {
    init, schemaStatus,
    withConnection: work => use(work, false),
    withTransaction: work => use(work, true),
    close: async () => { if (pool) { await pool.close(10); pool = undefined; } }
  };
}
