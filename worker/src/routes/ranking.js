/**
 * Ranking geral.
 *
 * Devolve tres coisas:
 *   - `topo`: os melhores, com apelido e avatar
 *   - `eu`:   a posicao e o percentil do proprio jogador
 *   - `distribuicao`: media, mediana e p90, para dar nocao de escala
 *
 * Apelido visivel a estranhos e conteudo gerado por usuario. As duas protecoes
 * exigidas existem: filtro na escrita (apelido.js) e canal de denuncia
 * (POST /v1/denuncias). Para esconder os nomes sem mexer em codigo:
 *   RANKING_MOSTRA_APELIDOS = "false"  (vars do wrangler.jsonc)
 */
import { falha } from '../http.js';
import { diasAtras, primeiro, todos } from '../db.js';
import { jogadorDoChamador } from '../lib/acesso.js';

const DIAS_DO_PERIODO = { semana: 7, mes: 30, todos: null };

// Melhor pontuacao de cada jogador no periodo/clave pedidos. Um jogador conta
// uma vez, pela sua melhor partida — nao pelo total acumulado, para que jogar
// muito nao valha mais que jogar bem.
//   ?1 = clave (ou null)   ?2 = data de corte (ou null)
const MELHORES_POR_JOGADOR = `
  select jogador_id, max(pontuacao) as melhor, min(jogada_em) as primeira
  from partidas
  where (?1 is null or clave = ?1)
    and (?2 is null or jogada_em > ?2)
  group by jogador_id
`;

export default [
  {
    metodo: 'GET',
    caminho: '/v1/ranking',
    auth: true,
    query: {
      type: 'object',
      properties: {
        clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
        periodo: { type: 'string', enum: ['semana', 'mes', 'todos'], default: 'semana' },
        jogador_id: { type: 'string', format: 'uuid' },
      },
    },
    async handler(c) {
      const { clave, periodo, jogador_id } = c.query;
      const dias = DIAS_DO_PERIODO[periodo];
      const corte = dias === null ? null : diasAtras(dias);
      const mostraApelidos = c.cfg.rankingMostraApelidos;

      const [distribuicao, topo] = await Promise.all([
        // O SQLite nao tem percentile_disc. Equivalente: o menor valor cuja
        // distribuicao acumulada (cume_dist) alcanca o percentil pedido.
        primeiro(
          c.db,
          `with melhores as (${MELHORES_POR_JOGADOR}),
                ordenados as (
                  select melhor, cume_dist() over (order by melhor) as acumulado
                  from melhores
                )
           select (select count(*) from melhores)                                as total_jogadores,
                  coalesce((select max(melhor) from melhores), 0)                as melhor_geral,
                  coalesce((select round(avg(melhor), 1) from melhores), 0)      as media,
                  coalesce((select min(melhor) from ordenados where acumulado >= 0.5), 0) as mediana,
                  coalesce((select min(melhor) from ordenados where acumulado >= 0.9), 0) as p90`,
          clave ?? null,
          corte
        ),
        todos(
          c.db,
          // Empate resolvido por quem chegou aquela pontuacao primeiro.
          `with melhores as (${MELHORES_POR_JOGADOR})
           select j.id, j.apelido, j.avatar, m.melhor
           from melhores m
           join jogadores j on j.id = m.jogador_id
           order by m.melhor desc, m.primeira asc
           limit ?3`,
          clave ?? null,
          corte,
          c.cfg.rankingTamanhoTopo
        ),
      ]);

      const resultado = {
        clave: clave ?? 'todas',
        periodo,
        mostra_apelidos: mostraApelidos,
        distribuicao,
        topo: topo.map((r, i) =>
          mostraApelidos
            ? { posicao: i + 1, jogador_id: r.id, apelido: r.apelido, avatar: r.avatar, melhor: r.melhor }
            : { posicao: i + 1, melhor: r.melhor }
        ),
        eu: null,
      };

      if (!jogador_id) return resultado;

      // Posicao do proprio jogador — so depois de confirmar que o perfil e dele.
      const jogador = await jogadorDoChamador(c.db, c.auth, jogador_id);
      if (!jogador) throw falha(404, 'Jogador nao encontrado.');

      const e = await primeiro(
        c.db,
        `with melhores as (${MELHORES_POR_JOGADOR}),
              minha as (select melhor from melhores where jogador_id = ?3)
         select (select melhor from minha)                                             as minha_melhor,
                (select count(*) from melhores where melhor > (select melhor from minha)) + 1 as posicao,
                (select count(*) from melhores)                                        as total`,
        clave ?? null,
        corte,
        jogador.id
      );

      if (e.minha_melhor === null) {
        resultado.eu = {
          jogador_id: jogador.id,
          minha_melhor: null,
          posicao: null,
          total: e.total,
          percentil: null,
        };
        return resultado;
      }

      // Percentil = quantos por cento dos jogadores voce superou.
      const percentil =
        e.total > 1 ? Math.round(((e.total - e.posicao) / (e.total - 1)) * 100) : 100;

      resultado.eu = { jogador_id: jogador.id, ...e, percentil };
      return resultado;
    },
  },
];
