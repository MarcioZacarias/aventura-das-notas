/**
 * Hinos (para o jogo) e painel do administrador.
 *
 * GET /v1/hinos entrega ao jogo os hinos ativos e o nivel minimo em que eles
 * comecam a aparecer. As rotas /v1/admin/* so atendem contas cujo e-mail
 * esta em ADMIN_EMAILS (wrangler.jsonc).
 */
import { json, falha } from '../http.js';
import { agora, executar, primeiro, todos, violouUnico } from '../db.js';

const CLAVES = ['sol', 'fa', 'do'];
const COMPASSOS = ['2/2', '2/4', '3/2', '3/4', '3/8', '4/4', '6/8', '9/8', '12/8'];

// Notas escritas: "E4 F4# B4b" (ver hinos.js). De 2 a 64 notas.
const RE_TRECHO = '^[A-G][1-7][#bn]?( [A-G][1-7][#bn]?){1,63}$';
const TRECHO = { type: 'string', maxLength: 320, pattern: RE_TRECHO };

const CAMPOS_HINO = {
  numero: { type: 'integer', minimum: 1, maximum: 9999 },
  nome: { type: 'string', minLength: 1, maxLength: 120 },
  tom: { type: 'string', minLength: 1, maxLength: 4, pattern: '^[A-G][#b]?m?$' },
  armadura: { type: 'integer', minimum: -7, maximum: 7 },
  compasso: { type: 'string', enum: COMPASSOS },
  andamento: { type: 'integer', minimum: 20, maximum: 300 },
  trecho_sol: TRECHO,
  trecho_fa: TRECHO,
  trecho_do: TRECHO,
  ativo: { type: 'boolean' },
};

const SELECT_HINO = `select id, numero, nome, tom, armadura, compasso, andamento,
                            trecho_sol, trecho_fa, trecho_do, ativo, atualizado_em
                     from hinos`;

async function nivelMinimo(db) {
  const linha = await primeiro(db, `select valor from configuracoes where chave = 'hinos_nivel_minimo'`);
  return Number(linha?.valor) || 3;
}

/** Linha do banco -> formato da API (ativo booleano, trechos agrupados). */
function formatar(h) {
  return {
    id: h.id,
    numero: h.numero,
    nome: h.nome,
    tom: h.tom,
    armadura: h.armadura,
    compasso: h.compasso,
    andamento: h.andamento,
    ativo: h.ativo === 1,
    trechos: { sol: h.trecho_sol || null, fa: h.trecho_fa || null, do: h.trecho_do || null },
    atualizado_em: h.atualizado_em,
  };
}

/** Campo vazio ("") de trecho = apagar o trecho daquela clave. */
function limparTrechos(corpo) {
  for (const c of CLAVES) {
    if (typeof corpo[`trecho_${c}`] === 'string') {
      corpo[`trecho_${c}`] = corpo[`trecho_${c}`].trim().replace(/\s+/g, ' ');
    }
  }
}

function exigirAlgumTrecho(h) {
  if (!CLAVES.some((c) => h[`trecho_${c}`])) {
    throw falha(400, 'Cadastre o trecho de pelo menos uma clave.');
  }
}

export default [
  // ---------------------------------------------------------------- jogo
  {
    metodo: 'GET',
    caminho: '/v1/hinos',
    auth: true,
    async handler(c) {
      const [nivel, linhas] = await Promise.all([
        nivelMinimo(c.db),
        todos(c.db, `${SELECT_HINO} where ativo = 1 order by numero`),
      ]);
      return {
        nivel_minimo: nivel,
        hinos: linhas.map(formatar).map(({ ativo, atualizado_em, ...h }) => h),
      };
    },
  },

  // --------------------------------------------------------------- admin
  {
    metodo: 'GET',
    caminho: '/v1/admin/config',
    auth: 'admin',
    async handler(c) {
      return { hinos_nivel_minimo: await nivelMinimo(c.db) };
    },
  },

  {
    metodo: 'PATCH',
    caminho: '/v1/admin/config',
    auth: 'admin',
    corpo: {
      type: 'object',
      required: ['hinos_nivel_minimo'],
      properties: { hinos_nivel_minimo: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    async handler(c) {
      await executar(
        c.db,
        `insert into configuracoes (chave, valor, atualizado_em) values ('hinos_nivel_minimo', ?1, ?2)
         on conflict (chave) do update set valor = ?1, atualizado_em = ?2`,
        String(c.corpo.hinos_nivel_minimo),
        agora()
      );
      return { hinos_nivel_minimo: c.corpo.hinos_nivel_minimo };
    },
  },

  {
    metodo: 'GET',
    caminho: '/v1/admin/hinos',
    auth: 'admin',
    async handler(c) {
      const linhas = await todos(c.db, `${SELECT_HINO} order by numero`);
      return { hinos: linhas.map(formatar) };
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/admin/hinos',
    auth: 'admin',
    corpo: {
      type: 'object',
      required: ['numero', 'nome', 'tom', 'armadura', 'compasso'],
      properties: CAMPOS_HINO,
    },
    async handler(c) {
      const h = { ...c.corpo };
      limparTrechos(h);
      exigirAlgumTrecho(h);
      try {
        const linha = await primeiro(
          c.db,
          `insert into hinos (numero, nome, tom, armadura, compasso, andamento,
                              trecho_sol, trecho_fa, trecho_do, ativo)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           returning id`,
          h.numero,
          h.nome.trim(),
          h.tom,
          h.armadura,
          h.compasso,
          h.andamento ?? null,
          h.trecho_sol || null,
          h.trecho_fa || null,
          h.trecho_do || null,
          h.ativo === false ? 0 : 1
        );
        const hino = await primeiro(c.db, `${SELECT_HINO} where id = ?`, linha.id);
        return json({ hino: formatar(hino) }, 201);
      } catch (e) {
        if (violouUnico(e)) throw falha(409, `Já existe um hino com o número ${h.numero}.`);
        throw e;
      }
    },
  },

  {
    metodo: 'PATCH',
    caminho: '/v1/admin/hinos/:id',
    auth: 'admin',
    params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } },
    corpo: {
      type: 'object',
      properties: {
        ...CAMPOS_HINO,
        // No PATCH, "" apaga o trecho daquela clave.
        trecho_sol: { anyOfVazio: true, ...TRECHO },
        trecho_fa: { anyOfVazio: true, ...TRECHO },
        trecho_do: { anyOfVazio: true, ...TRECHO },
      },
    },
    async handler(c) {
      const atual = await primeiro(c.db, `${SELECT_HINO} where id = ?`, c.params.id);
      if (!atual) throw falha(404, 'Hino não encontrado.');

      const corpo = { ...c.corpo };
      limparTrechos(corpo);
      if (corpo.ativo !== undefined) corpo.ativo = corpo.ativo ? 1 : 0;
      if (corpo.nome !== undefined) corpo.nome = corpo.nome.trim();

      const novo = { ...atual, ...corpo };
      for (const cl of CLAVES) if (novo[`trecho_${cl}`] === '') novo[`trecho_${cl}`] = null;
      exigirAlgumTrecho(novo);

      try {
        await executar(
          c.db,
          `update hinos set numero = ?, nome = ?, tom = ?, armadura = ?, compasso = ?, andamento = ?,
                            trecho_sol = ?, trecho_fa = ?, trecho_do = ?, ativo = ?, atualizado_em = ?
           where id = ?`,
          novo.numero,
          novo.nome,
          novo.tom,
          novo.armadura,
          novo.compasso,
          novo.andamento ?? null,
          novo.trecho_sol,
          novo.trecho_fa,
          novo.trecho_do,
          novo.ativo,
          agora(),
          atual.id
        );
      } catch (e) {
        if (violouUnico(e)) throw falha(409, `Já existe um hino com o número ${novo.numero}.`);
        throw e;
      }
      const hino = await primeiro(c.db, `${SELECT_HINO} where id = ?`, atual.id);
      return { hino: formatar(hino) };
    },
  },

  {
    metodo: 'DELETE',
    caminho: '/v1/admin/hinos/:id',
    auth: 'admin',
    params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } },
    async handler(c) {
      const r = await executar(c.db, 'delete from hinos where id = ?', c.params.id);
      if (!r.meta?.changes) throw falha(404, 'Hino não encontrado.');
      return { ok: true };
    },
  },
];
