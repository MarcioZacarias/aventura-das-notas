/**
 * Perfis de jogador. Sao os perfis das criancas: apelido e avatar, nada mais.
 * Nenhum dado pessoal e coletado aqui — e isso que mantem o app fora do
 * escopo pesado da Politica de Familias e do Art. 14 da LGPD.
 */
import { createHash } from 'node:crypto';
import { q, transacao } from '../db.js';
import { exigirAuth, exigirConta } from '../lib/autenticacao.js';
import { exigirJogador } from '../lib/propriedade.js';
import { validarApelido } from '../lib/apelido.js';

const MAX_JOGADORES = 10;

const corpoJogador = {
  type: 'object',
  required: ['apelido'],
  properties: {
    apelido: { type: 'string', minLength: 2, maxLength: 20 },
    avatar: { type: 'string', maxLength: 16 },
  },
  additionalProperties: false,
};

export default async function rotasJogadores(app) {
  app.get('/jogadores', { preHandler: exigirAuth }, async (req) => {
    const { tipo, id } = req.autenticado;
    const coluna = tipo === 'conta' ? 'conta_id' : 'dispositivo_id';
    const { rows } = await q(
      `select id, apelido, avatar, criado_em from jogadores
       where ${coluna} = $1 order by criado_em`,
      [id]
    );
    return { jogadores: rows };
  });

  app.post(
    '/jogadores',
    { preHandler: exigirAuth, schema: { body: corpoJogador } },
    async (req, resposta) => {
      const { tipo, id } = req.autenticado;
      const apelido = req.body.apelido.trim();
      const avatar = (req.body.avatar || 'musica').trim();

      // O apelido fica visivel no ranking geral, entao passa pela moderacao.
      const problema = validarApelido(apelido);
      if (problema) return resposta.code(400).send({ erro: problema });

      const coluna = tipo === 'conta' ? 'conta_id' : 'dispositivo_id';

      const { rows: existentes } = await q(
        `select count(*)::int as total from jogadores where ${coluna} = $1`,
        [id]
      );
      if (existentes[0].total >= MAX_JOGADORES) {
        return resposta
          .code(409)
          .send({ erro: `Limite de ${MAX_JOGADORES} jogadores atingido.` });
      }

      const { rows } = await q(
        `insert into jogadores (${coluna}, apelido, avatar)
         values ($1, $2, $3) returning id, apelido, avatar, criado_em`,
        [id, apelido, avatar]
      );
      return resposta.code(201).send({ jogador: rows[0] });
    }
  );

  app.patch(
    '/jogadores/:id',
    {
      preHandler: exigirAuth,
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          properties: {
            apelido: { type: 'string', minLength: 2, maxLength: 20 },
            avatar: { type: 'string', maxLength: 16 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.params.id);
      if (!jogador) return;

      const apelido = req.body.apelido?.trim() ?? jogador.apelido;
      const avatar = req.body.avatar?.trim() ?? jogador.avatar;

      if (apelido !== jogador.apelido) {
        const problema = validarApelido(apelido);
        if (problema) return resposta.code(400).send({ erro: problema });
      }

      const { rows } = await q(
        `update jogadores set apelido = $2, avatar = $3
         where id = $1 returning id, apelido, avatar, criado_em`,
        [jogador.id, apelido, avatar]
      );
      return { jogador: rows[0] };
    }
  );

  app.delete(
    '/jogadores/:id',
    {
      preHandler: exigirAuth,
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.params.id);
      if (!jogador) return;
      // Cascade apaga partidas e vinculos de turma junto.
      await q('delete from jogadores where id = $1', [jogador.id]);
      return { ok: true };
    }
  );

  /**
   * "Adocao" do perfil anonimo por uma conta.
   *
   * Cenario: a crianca jogou meses sem cadastro; depois o responsavel cria
   * conta e quer levar o historico. O cliente esta logado na conta E ainda
   * guarda as credenciais do aparelho, entao provamos as duas posses de uma vez.
   */
  app.post(
    '/jogadores/vincular',
    {
      preHandler: exigirConta,
      schema: {
        body: {
          type: 'object',
          required: ['dispositivo_id', 'segredo'],
          properties: {
            dispositivo_id: { type: 'string', format: 'uuid' },
            segredo: { type: 'string', minLength: 10, maxLength: 200 },
            // Opcional: vincula so um jogador. Sem isso, vincula todos do aparelho.
            jogador_id: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const contaId = req.autenticado.id;
      const { dispositivo_id, segredo, jogador_id } = req.body;
      const hash = createHash('sha256').update(segredo).digest('hex');

      const { rows: disp } = await q(
        'select id from dispositivos where id = $1 and segredo_hash = $2',
        [dispositivo_id, hash]
      );
      if (!disp.length) {
        return resposta.code(401).send({ erro: 'Credenciais do aparelho invalidas.' });
      }

      return transacao(async (c) => {
        const { rows: cabem } = await c.query(
          'select count(*)::int as total from jogadores where conta_id = $1',
          [contaId]
        );
        const disponiveis = MAX_JOGADORES - cabem[0].total;
        if (disponiveis <= 0) {
          return resposta
            .code(409)
            .send({ erro: `Limite de ${MAX_JOGADORES} jogadores na conta atingido.` });
        }

        const params = [dispositivo_id, contaId, disponiveis];
        const filtroJogador = jogador_id ? 'and id = $4' : '';
        if (jogador_id) params.push(jogador_id);

        const { rows } = await c.query(
          `update jogadores set conta_id = $2
           where id in (
             select id from jogadores
             where dispositivo_id = $1 and conta_id is null ${filtroJogador}
             order by criado_em
             limit $3
           )
           returning id, apelido, avatar, criado_em`,
          params
        );
        return { vinculados: rows.length, jogadores: rows };
      });
    }
  );
}
