/** Envio de partidas e historico/estatisticas por jogador. */
import { q } from '../db.js';
import { exigirAuth } from '../lib/autenticacao.js';
import { config } from '../config.js';
import { exigirJogador } from '../lib/propriedade.js';
import { validarPartida } from '../lib/plausibilidade.js';

export default async function rotasPartidas(app) {
  /**
   * Grava uma partida encerrada.
   *
   * Idempotente por (jogador_id, cliente_partida_id): a fila offline do app
   * pode reenviar a mesma partida quantas vezes quiser sem duplicar. Isso e o
   * que torna o "offline-first" seguro — o cliente reenvia ate ter certeza.
   */
  app.post(
    '/partidas',
    {
      preHandler: exigirAuth,
      config: { rateLimit: { max: config.limitePartidas, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: [
            'jogador_id',
            'cliente_partida_id',
            'clave',
            'pontuacao',
            'acertos',
            'erros',
            'nivel_max',
            'duracao_ms',
          ],
          properties: {
            jogador_id: { type: 'string', format: 'uuid' },
            cliente_partida_id: { type: 'string', format: 'uuid' },
            clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
            pontuacao: { type: 'integer', minimum: 0, maximum: 100000 },
            acertos: { type: 'integer', minimum: 0, maximum: 100000 },
            erros: { type: 'integer', minimum: 0, maximum: 1000 },
            nivel_max: { type: 'integer', minimum: 1, maximum: 10000 },
            duracao_ms: { type: 'integer', minimum: 1, maximum: 7200000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.body.jogador_id);
      if (!jogador) return;

      // Cliente pode mentir: o servidor recalcula o que era possivel.
      const veredito = validarPartida(req.body);
      if (!veredito.ok) {
        req.log.warn(
          { jogador_id: jogador.id, corpo: req.body, motivo: veredito.motivo },
          'partida rejeitada pela validacao de plausibilidade'
        );
        return resposta.code(422).send({ erro: veredito.motivo });
      }

      const { cliente_partida_id, clave, pontuacao, acertos, erros, nivel_max, duracao_ms } =
        req.body;

      const { rows } = await q(
        `insert into partidas
           (jogador_id, cliente_partida_id, clave, pontuacao, acertos, erros, nivel_max, duracao_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (jogador_id, cliente_partida_id) do nothing
         returning id, jogada_em`,
        [jogador.id, cliente_partida_id, clave, pontuacao, acertos, erros, nivel_max, duracao_ms]
      );

      // Sem linha retornada = era reenvio. Respondemos 200 em vez de erro, para
      // a fila do cliente poder marcar como enviada e seguir.
      if (!rows.length) {
        return resposta.code(200).send({ ok: true, duplicada: true });
      }

      // Recorde pessoal naquela clave, para o app poder celebrar.
      const { rows: rec } = await q(
        `select max(pontuacao)::int as recorde from partidas
         where jogador_id = $1 and clave = $2`,
        [jogador.id, clave]
      );

      return resposta.code(201).send({
        ok: true,
        duplicada: false,
        partida_id: rows[0].id,
        jogada_em: rows[0].jogada_em,
        recorde_clave: rec[0].recorde,
        novo_recorde: rec[0].recorde === pontuacao,
      });
    }
  );

  app.get(
    '/jogadores/:id/partidas',
    {
      preHandler: exigirAuth,
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
        querystring: {
          type: 'object',
          properties: {
            limite: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
          },
        },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.params.id);
      if (!jogador) return;

      const { limite = 50, clave } = req.query;
      const { rows } = await q(
        `select id, clave, pontuacao, nivel_max, acertos, erros, duracao_ms, jogada_em
         from partidas
         where jogador_id = $1 and ($2::text is null or clave = $2)
         order by jogada_em desc
         limit $3`,
        [jogador.id, clave ?? null, limite]
      );
      return { partidas: rows };
    }
  );

  /** Evolucao do jogador: recorde e medias por clave, mais os ultimos 30 dias. */
  app.get(
    '/jogadores/:id/estatisticas',
    {
      preHandler: exigirAuth,
      schema: {
        params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      },
    },
    async (req, resposta) => {
      const jogador = await exigirJogador(req, resposta, req.params.id);
      if (!jogador) return;

      const [porClave, geral, evolucao] = await Promise.all([
        q(
          `select clave,
                  count(*)::int              as partidas,
                  max(pontuacao)::int        as recorde,
                  round(avg(pontuacao), 1)   as media,
                  max(nivel_max)::int        as nivel_max,
                  sum(acertos)::int          as acertos,
                  sum(erros)::int            as erros,
                  max(jogada_em)             as ultima
           from partidas where jogador_id = $1
           group by clave order by clave`,
          [jogador.id]
        ),
        q(
          `select count(*)::int            as partidas,
                  max(pontuacao)::int      as recorde,
                  sum(acertos)::int        as acertos,
                  sum(erros)::int          as erros,
                  sum(duracao_ms)::bigint  as tempo_total_ms
           from partidas where jogador_id = $1`,
          [jogador.id]
        ),
        q(
          `select date_trunc('day', jogada_em)::date as dia,
                  count(*)::int                      as partidas,
                  max(pontuacao)::int                as melhor
           from partidas
           where jogador_id = $1 and jogada_em > now() - interval '30 days'
           group by dia order by dia`,
          [jogador.id]
        ),
      ]);

      // Taxa de acerto: quantas notas o jogador acertou do total que apareceu.
      const g = geral.rows[0];
      const totalNotas = (g.acertos || 0) + (g.erros || 0);
      const precisao = totalNotas > 0 ? Math.round((g.acertos / totalNotas) * 1000) / 10 : null;

      return {
        jogador: { id: jogador.id, apelido: jogador.apelido, avatar: jogador.avatar },
        geral: { ...g, precisao_pct: precisao },
        por_clave: porClave.rows,
        evolucao_30_dias: evolucao.rows,
      };
    }
  );
}
