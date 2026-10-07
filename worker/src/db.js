/**
 * Atalhos sobre o D1.
 *
 * Datas sao texto ISO 8601 em UTC, no mesmo formato que Date#toISOString()
 * produz e que o default das tabelas grava. Por isso comparar datas com < e >
 * funciona direto como comparacao de texto.
 */

export const agora = () => new Date().toISOString();

/** Instante `dias` atras, no formato das colunas de data. */
export const diasAtras = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

export async function todos(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/** Primeira linha, ou null. */
export function primeiro(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

export function executar(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

/** O D1 nao expoe codigo de erro (como o 23505 do Postgres); so a mensagem. */
export function violouUnico(e) {
  const texto = `${e?.message || ''} ${e?.cause?.message || ''}`;
  return /UNIQUE constraint failed/i.test(texto);
}
