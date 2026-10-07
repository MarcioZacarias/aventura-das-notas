/**
 * Runner de migrations. Aplica os .sql de migrations/ em ordem alfabetica,
 * uma vez cada, dentro de uma transacao por arquivo.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, esperarBanco, transacao } from './db.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrar() {
  await esperarBanco();

  await pool.query(`
    create table if not exists _migrations (
      nome        text primary key,
      aplicada_em timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query('select nome from _migrations');
  const aplicadas = new Set(rows.map((r) => r.nome));

  const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  let novas = 0;

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = await readFile(join(dir, arquivo), 'utf8');
    console.log(`Aplicando migration ${arquivo}...`);
    await transacao(async (c) => {
      await c.query(sql);
      await c.query('insert into _migrations (nome) values ($1)', [arquivo]);
    });
    novas++;
  }

  console.log(
    novas === 0
      ? `Banco atualizado (${arquivos.length} migration(s) ja aplicadas).`
      : `${novas} migration(s) aplicada(s).`
  );
}
