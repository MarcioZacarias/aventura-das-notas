/** Pool de conexoes Postgres. */
import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do Postgres:', err.message);
});

/** Atalho para query simples. */
export function q(texto, params) {
  return pool.query(texto, params);
}

/** Executa uma funcao dentro de uma transacao, com rollback em caso de erro. */
export async function transacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

/** Espera o banco aceitar conexao. O compose ja tem healthcheck, isto e cinto de seguranca. */
export async function esperarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query('select 1');
      return;
    } catch (e) {
      if (i === tentativas) throw e;
      console.log(`Aguardando o banco... (${i}/${tentativas})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
