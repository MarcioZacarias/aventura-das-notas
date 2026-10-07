/** Entrypoint para rodar as migrations isoladamente: npm run migrate */
import { pool } from './db.js';
import { migrar } from './migrate.js';

try {
  await migrar();
} catch (e) {
  console.error('Falha na migration:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
