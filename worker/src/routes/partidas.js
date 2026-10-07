/** Envio de partidas e historico/estatisticas por jogador. */
import { json, falha } from '../http.js';
import { diasAtras, primeiro, todos } from '../db.js';
import { exigirJogador } from '../lib/acesso.js';
import { validarPartida } from '../../../server/src/lib/plausibilidade.js';

const CLAVES = ['sol', 'fa', 'do'];

const paramId = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
};

export default [
  /**
   * Grava uma partida encerrada.
   *
   * Idempotente por (jogador_id, cliente_partida_id): a fila offline do app
   * pode reenviar a mesma partida quantas vezes quiser sem duplicar.
   */
  {
    metodo: 'POST',
    caminho: '/v1/partidas',
    auth: true,
    limite: 'LIMITE_PARTIDAS',
    corpo: {
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
        clave: { type: 'string', enum: CLAVES },
        pontuacao: { type: 'integer', minimum: 0, maximum: 100000 },
        acertos: { type: 'integer', minimum: 0, maximum: 100000 },
        erros: { type: 'integer', minimum: 0, maximum: 1000 },
        nivel_max: { type: 'integer', minimum: 1, maximum: 10000 },
        duracao_ms: { type: 'integer', minimum: 1, maximum: 7200000 },
      },
    },
    async handler(c) {
      const jogador = await exigirJogador(c, c.corpo.jogador_id);

      // Cliente pode mentir: o servidor recalcula o que era possivel.
      const veredito = validarPartida(c.corpo);
      if (!veredito.ok) {
        console.warn(
          JSON.stringify({
            msg: 'partida rejeitada pela validacao de plausibilidade',
            jogador_id: jogador.id,
            corpo: c.corpo,
            motivo: veredito.motivo,
          })
        );
        throw falha(422, veredito.motivo);
      }

      const { cliente_partida_id, clave, pontuacao, acertos, erros, nivel_max, duracao_ms } =
        c.corpo;

      const inserida = await primeiro(
        c.db,
        `insert into partidas
           (jogador_id, cliente_partida_id, clave, pontuacao, acertos, erros, nivel_max, duracao_ms)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (jogador_id, cliente_partida_id) do nothing
         returning id, jogada_em`,
        jogador.id,
        cliente_partida_id,
        clave,
        pontuacao,
        acertos,
        erros,
        nivel_max,
        duracao_ms
      );

      // Sem linha retornada = era reenvio. Respondemos 200 em vez de erro, para
      // a fila do cliente poder marcar como enviada e seguir.
      if (!inserida) return { ok: true, duplicada: true };

      // Recorde pessoal naquela clave, para o app poder celebrar.
      const { recorde } = await primeiro(
        c.db,
        'select max(pontuacao) as recorde from partidas where jogador_id = ? and clave = ?',
        jogador.id,
        clave
      );

      return json(
        {
          ok: true,
          duplicada: false,
          partida_id: inserida.id,
          jogada_em: inserida.jogada_em,
          recorde_clave: recorde,
          novo_recorde: recorde === pontuacao,
        },
        201
      );
    },
  },

  {
    metodo: 'GET',
    caminho: '/v1/jogadores/:id/partidas',
    auth: true,
    params: paramId,
    query: {
      type: 'object',
      properties: {
        limite: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        clave: { type: 'string', enum: CLAVES },
      },
    },
    async handler(c) {
      const jogador = await exigirJogador(c, c.params.id);

      const partidas = await todos(
        c.db,
        `select id, clave, pontuacao, nivel_max, acertos, erros, duracao_ms, jogada_em
         from partidas
         where jogador_id = ?1 and (?2 is null or clave = ?2)
         order by jogada_em desc
         limit ?3`,
        jogador.id,
        c.query.clave ?? null,
        c.query.limite
      );
      return { partidas };
    },
  },

  /** Evolucao do jogador: recorde e medias por clave, mais os ultimos 30 dias. */
  {
    metodo: 'GET',
    caminho: '/v1/jogadores/:id/estatisticas',
    auth: true,
    params: paramId,
    async handler(c) {
      const jogador = await exigirJogador(c, c.params.id);

      const [porClave, geral, evolucao] = await Promise.all([
        todos(
          c.db,
          `select clave,
                  count(*)                 as partidas,
                  max(pontuacao)           as recorde,
                  round(avg(pontuacao), 1) as media,
                  max(nivel_max)           as nivel_max,
                  sum(acertos)             as acertos,
                  sum(erros)               as erros,
                  max(jogada_em)           as ultima
           from partidas where jogador_id = ?
           group by clave order by clave`,
          jogador.id
        ),
        primeiro(
          c.db,
          `select count(*)        as partidas,
                  max(pontuacao)  as recorde,
                  sum(acertos)    as acertos,
                  sum(erros)      as erros,
                  sum(duracao_ms) as tempo_total_ms
           from partidas where jogador_id = ?`,
          jogador.id
        ),
        todos(
          c.db,
          // Dia em UTC, "AAAA-MM-DD".
          `select substr(jogada_em, 1, 10) as dia,
                  count(*)                 as partidas,
                  max(pontuacao)           as melhor
           from partidas
           where jogador_id = ? and jogada_em > ?
           group by dia order by dia`,
          jogador.id,
          diasAtras(30)
        ),
      ]);

      // Taxa de acerto: quantas notas o jogador acertou do total que apareceu.
      const totalNotas = (geral.acertos || 0) + (geral.erros || 0);
      const precisao =
        totalNotas > 0 ? Math.round((geral.acertos / totalNotas) * 1000) / 10 : null;

      return {
        jogador: { id: jogador.id, apelido: jogador.apelido, avatar: jogador.avatar },
        geral: { ...geral, precisao_pct: precisao },
        por_clave: porClave,
        evolucao_30_dias: evolucao,
      };
    },
  },
];
