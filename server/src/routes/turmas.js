/**
 * Turmas: o substituto de "amizade entre jogadores".
 *
 * Em vez de descoberta aberta de estranhos, um adulto cria a turma e distribui
 * um codigo de 6 caracteres. So quem recebe o codigo entra. O ranking com
 * apelidos acontece apenas aqui dentro — grupo fechado, com um responsavel
 * identificado como dono.
 *
 * Isso entrega a competicao entre colegas (que era o objetivo) sem criar uma
 * rede social infantil aberta, que exigiria moderacao, denuncia, bloqueio e
 * consentimento parental verificavel.
 */
import { randomInt } from 'node:crypto';
import { q } from '../db.js';
import { config } from '../config.js';
import { exigirAuth, exigirConta } from '../lib/autenticacao.js';
import { exigirJogador } from '../lib/propriedade.js';

// Alfabeto sem caracteres ambiguos (sem I, O, 0, 1): o codigo e ditado em voz
// alta ou copiado a mao por criancas. Precisa casar com o CHECK da migration.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAM_CODIGO = 6;
const UNIQUE_VIOLATION = '23505';
const MAX_TURMAS_POR_CONTA = 20;

function gerarCodigo() {
  let s = '';
  for (let i = 0; i < TAM_CODIGO; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

export default async function rotasTurmas(app) {
  app.post(
    '/turmas',
    {
      preHandler: exigirConta,
      schema: {
        body: {
          type: 'object',
          required: ['nome'],
          properties: { nome: { type: 'string', minLength: 2, maxLength: 60 } },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const contaId = req.autenticado.id;
      const nome = req.body.nome.trim();

      const { rows: cont } = await q(
        'select count(*)::int as total from turmas where dono_conta_id = $1',
        [contaId]
      );
      if (cont[0].total >= MAX_TURMAS_POR_CONTA) {
        return resposta
          .code(409)
          .send({ erro: `Limite de ${MAX_TURMAS_POR_CONTA} turmas atingido.` });
      }

      // 32^6 = ~1 bilhao de codigos; colisao e rara, mas tratada.
      for (let tentativa = 0; tentativa < 8; tentativa++) {
        try {
          const { rows } = await q(
            `insert into turmas (dono_conta_id, nome, codigo)
             values ($1, $2, $3) returning id, nome, codigo, criado_em`,
            [contaId, nome, gerarCodigo()]
          );
          return resposta.code(201).send({ turma: rows[0] });
        } catch (e) {
          if (e.code !== UNIQUE_VIOLATION) throw e;
        }
      }
      return resposta
        .code(503)
        .send({ erro: 'Nao foi possivel gerar um codigo de turma. Tente de novo.' });
    }
  );

  /** Turmas que eu administro + turmas em que meus jogadores estao. */
  app.get('/turmas', { preHandler: exigirAuth }, async (req) => {
    const { tipo, id } = req.autenticado;
    const coluna = tipo === 'conta' ? 'conta_id' : 'dispositivo_id';

    const minhas =
      tipo === 'conta'
        ? (
            await q(
              `select t.id, t.nome, t.codigo, t.criado_em,
                      (select count(*)::int from turma_membros m where m.turma_id = t.id) as membros
               from turmas t where t.dono_conta_id = $1 order by t.criado_em`,
              [id]
            )
          ).rows
        : [];

    const participando = (
      await q(
        `select distinct t.id, t.nome, t.criado_em, m.jogador_id
         from turmas t
         join turma_membros m on m.turma_id = t.id
         join jogadores j on j.id = m.jogador_id
         where j.${coluna} = $1
         order by t.criado_em`,
        [id]
      )
    ).rows;

    return { administro: minhas, participando };
  });

  app.post(
    '/turmas/entrar',
    {
      preHandler: exigirAuth,
      config: { rateLimit: { max: config.limiteTurma, timeWindow: '5 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['codigo', 'jogador_id'],
          properties: {
            codigo: { type: 'string', minLength: 6, maxLength: 6 },
            jogador_id: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.body.jogador_id);
      if (!jogador) return;

      const codigo = req.body.codigo.trim().toUpperCase();

      const { rows } = await q('select id, nome from turmas where codigo = $1', [codigo]);
      if (!rows.length) return resposta.code(404).send({ erro: 'Codigo de turma invalido.' });
      const turma = rows[0];

      await q(
        `insert into turma_membros (turma_id, jogador_id) values ($1, $2)
         on conflict (turma_id, jogador_id) do nothing`,
        [turma.id, jogador.id]
      );

      return { ok: true, turma: { id: turma.id, nome: turma.nome } };
    }
  );

  app.post(
    '/turmas/sair',
    {
      preHandler: exigirAuth,
      schema: {
        body: {
          type: 'object',
          required: ['turma_id', 'jogador_id'],
          properties: {
            turma_id: { type: 'string', format: 'uuid' },
            jogador_id: { type: 'string', format: 'uuid' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.body.jogador_id);
      if (!jogador) return;
      await q('delete from turma_membros where turma_id = $1 and jogador_id = $2', [
        req.body.turma_id,
        jogador.id,
      ]);
      return { ok: true };
    }
  );

  /**
   * Ranking da turma — aqui os apelidos APARECEM, porque e grupo fechado com
   * dono responsavel. Acesso permitido ao dono da turma ou a quem tem um
   * jogador dentro dela.
   */
  app.get(
    '/turmas/:id/ranking',
    {
      preHandler: exigirAuth,
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        querystring: {
          type: 'object',
          properties: {
            clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
            periodo: { type: 'string', enum: ['semana', 'mes', 'todos'], default: 'todos' },
          },
        },
      },
    },
    async (req, resposta) => {
      const turmaId = req.params.id;
      const { tipo, id: autorId } = req.autenticado;
      const coluna = tipo === 'conta' ? 'conta_id' : 'dispositivo_id';

      const { rows: permissao } = await q(
        `select
           exists(select 1 from turmas where id = $1 and dono_conta_id = $2) as sou_dono,
           exists(
             select 1 from turma_membros m
             join jogadores j on j.id = m.jogador_id
             where m.turma_id = $1 and j.${coluna} = $3
           ) as tenho_jogador`,
        [turmaId, tipo === 'conta' ? autorId : null, autorId]
      );

      if (!permissao[0].sou_dono && !permissao[0].tenho_jogador) {
        return resposta.code(404).send({ erro: 'Turma nao encontrada.' });
      }

      const intervalo =
        req.query.periodo === 'semana' ? '7 days' : req.query.periodo === 'mes' ? '30 days' : null;

      const { rows } = await q(
        `select j.id, j.apelido, j.avatar,
                max(p.pontuacao)::int   as melhor,
                count(p.id)::int        as partidas,
                max(p.jogada_em)        as ultima
         from turma_membros m
         join jogadores j on j.id = m.jogador_id
         left join partidas p on p.jogador_id = j.id
              and ($2::text is null or p.clave = $2)
              and ($3::interval is null or p.jogada_em > now() - $3::interval)
         where m.turma_id = $1
         group by j.id, j.apelido, j.avatar
         order by melhor desc nulls last, partidas desc, j.apelido`,
        [turmaId, req.query.clave ?? null, intervalo]
      );

      return {
        turma_id: turmaId,
        clave: req.query.clave ?? 'todas',
        periodo: req.query.periodo ?? 'todos',
        ranking: rows.map((r, i) => ({ posicao: i + 1, ...r })),
      };
    }
  );
}
