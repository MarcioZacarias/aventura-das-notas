/**
 * Sugestoes: o usuario envia e acompanha as suas; o administrador avalia.
 *
 * Quando o administrador marca uma sugestao como 'implementada' (ou muda o
 * estado de qualquer outra forma), autor_viu volta a 0 e o jogo mostra a
 * novidade ao autor na proxima vez que ele abrir.
 */
import { json, falha } from '../http.js';
import { agora, executar, primeiro, todos } from '../db.js';

const ESTADOS = ['recebida', 'em_avaliacao', 'aceita', 'implementada', 'recusada'];
const MAX_ABERTAS = 10; // por autor, ainda sem resposta final

/** Filtro do autor: conta logada ou aparelho anonimo. */
const autor = (auth) =>
  auth.tipo === 'conta' ? { coluna: 'conta_id', id: auth.id } : { coluna: 'dispositivo_id', id: auth.id };

const CAMPOS_AUTOR = 'id, texto, estado, resposta, autor_viu, criado_em, atualizado_em';

const formatar = (s) => ({ ...s, autor_viu: s.autor_viu === 1 });

export default [
  {
    metodo: 'POST',
    caminho: '/v1/sugestoes',
    auth: true,
    limite: 'LIMITE_SUGESTAO',
    corpo: {
      type: 'object',
      required: ['texto'],
      properties: {
        texto: { type: 'string', minLength: 5, maxLength: 1000 },
        apelido: { type: 'string', maxLength: 20 },
      },
    },
    async handler(c) {
      const texto = c.corpo.texto.trim();
      if (texto.length < 5) throw falha(400, 'Escreva sua sugestão com pelo menos 5 letras.');
      const { coluna, id } = autor(c.auth);

      const { total } = await primeiro(
        c.db,
        `select count(*) as total from sugestoes
         where ${coluna} = ? and estado in ('recebida', 'em_avaliacao')`,
        id
      );
      if (total >= MAX_ABERTAS) {
        throw falha(429, 'Você já tem várias sugestões esperando avaliação. Aguarde a resposta delas.');
      }

      const sugestao = await primeiro(
        c.db,
        `insert into sugestoes (${coluna}, apelido, texto) values (?, ?, ?)
         returning ${CAMPOS_AUTOR}`,
        id,
        c.corpo.apelido ? c.corpo.apelido.trim().slice(0, 20) : null,
        texto
      );
      return json({ sugestao: formatar(sugestao) }, 201);
    },
  },

  {
    metodo: 'GET',
    caminho: '/v1/sugestoes',
    auth: true,
    async handler(c) {
      const { coluna, id } = autor(c.auth);
      const linhas = await todos(
        c.db,
        `select ${CAMPOS_AUTOR} from sugestoes where ${coluna} = ? order by criado_em desc limit 50`,
        id
      );
      return { sugestoes: linhas.map(formatar) };
    },
  },

  /** O autor viu as novidades: zera o aviso. */
  {
    metodo: 'POST',
    caminho: '/v1/sugestoes/vistas',
    auth: true,
    async handler(c) {
      const { coluna, id } = autor(c.auth);
      await executar(c.db, `update sugestoes set autor_viu = 1 where ${coluna} = ? and autor_viu = 0`, id);
      return { ok: true };
    },
  },

  // ----------------------------------------------------------------- admin
  {
    metodo: 'GET',
    caminho: '/v1/admin/sugestoes',
    auth: 'admin',
    query: {
      type: 'object',
      properties: { estado: { type: 'string', enum: ESTADOS } },
    },
    async handler(c) {
      const linhas = await todos(
        c.db,
        `select s.id, s.texto, s.estado, s.resposta, s.apelido, s.criado_em, s.atualizado_em,
                coalesce(ct.nome, 'Aparelho sem conta') as autor_nome
         from sugestoes s
         left join contas ct on ct.id = s.conta_id
         where (?1 is null or s.estado = ?1)
         order by case s.estado when 'recebida' then 0 when 'em_avaliacao' then 1 when 'aceita' then 2 else 3 end,
                  s.criado_em desc
         limit 300`,
        c.query.estado ?? null
      );
      return { sugestoes: linhas };
    },
  },

  {
    metodo: 'PATCH',
    caminho: '/v1/admin/sugestoes/:id',
    auth: 'admin',
    params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } },
    corpo: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ESTADOS },
        resposta: { type: 'string', maxLength: 500, anyOfVazio: true },
      },
    },
    async handler(c) {
      const atual = await primeiro(c.db, 'select id, estado, resposta from sugestoes where id = ?', c.params.id);
      if (!atual) throw falha(404, 'Sugestão não encontrada.');

      const estado = c.corpo.estado ?? atual.estado;
      const resposta = c.corpo.resposta === undefined ? atual.resposta : c.corpo.resposta.trim() || null;
      // Qualquer mudanca visivel ao autor vira novidade para ele.
      const mudou = estado !== atual.estado || resposta !== atual.resposta;

      const sugestao = await primeiro(
        c.db,
        `update sugestoes set estado = ?, resposta = ?, atualizado_em = ?,
                autor_viu = case when ? then 0 else autor_viu end
         where id = ?
         returning id, texto, estado, resposta, apelido, criado_em, atualizado_em`,
        estado,
        resposta,
        agora(),
        mudou ? 1 : 0,
        atual.id
      );
      return { sugestao };
    },
  },
];
