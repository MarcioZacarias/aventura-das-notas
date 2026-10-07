/**
 * Ranking geral.
 *
 * Devolve tres coisas:
 *   - `topo`: os melhores, com apelido e avatar
 *   - `eu`:   a posicao e o percentil do proprio jogador
 *   - `distribuicao`: media, mediana e p90, para dar noção de escala
 *
 * SOBRE EXIBIR APELIDOS AQUI
 *
 * Apelido escrito por usuario, visivel a estranhos, e conteudo gerado por
 * usuario. Num app cujo publico-alvo inclui criancas, isso so e admissivel com
 * duas protecoes, e as duas existem:
 *
 *   1. Filtro na escrita  -> lib/apelido.js, aplicado em POST e PATCH /jogadores
 *   2. Canal de denuncia  -> POST /v1/denuncias
 *
 * Se em algum momento a moderacao nao der conta, ou uma loja questionar, da
 * para desligar os nomes sem mexer em codigo:
 *
 *   RANKING_MOSTRA_APELIDOS=false
 *
 * Com isso o `topo` volta a ser so uma lista de pontuacoes, sem identidade, e o
 * resto do ranking continua funcionando.
 *
 * O ranking de TURMA (routes/turmas.js) sempre mostra apelidos, porque e grupo
 * fechado com um adulto responsavel como dono.
 */
import { q } from '../db.js';
import { config } from '../config.js';
import { exigirAuth } from '../lib/autenticacao.js';
import { jogadorDoChamador } from '../lib/propriedade.js';

const INTERVALOS = {
  semana: '7 days',
  mes: '30 days',
  todos: null,
};

export default async function rotasRanking(app) {
  app.get(
    '/ranking',
    {
      preHandler: exigirAuth,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
            periodo: { type: 'string', enum: ['semana', 'mes', 'todos'], default: 'semana' },
            jogador_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (req, resposta) => {
      const { clave, periodo = 'semana', jogador_id } = req.query;
      const intervalo = INTERVALOS[periodo];
      const limite = config.rankingTamanhoTopo;

      // Melhor pontuacao de cada jogador no periodo/clave pedidos. Um jogador
      // conta uma vez, pela sua melhor partida — nao pelo total acumulado, para
      // que jogar muito nao valha mais que jogar bem.
      const melhoresPorJogador = `
        select jogador_id, max(pontuacao) as melhor, min(jogada_em) as primeira
        from partidas
        where ($1::text is null or clave = $1)
          and ($2::interval is null or jogada_em > now() - $2::interval)
        group by jogador_id
      `;

      const [dist, topo] = await Promise.all([
        q(
          `with melhores as (${melhoresPorJogador})
           select count(*)::int                                                       as total_jogadores,
                  coalesce(max(melhor), 0)::int                                       as melhor_geral,
                  coalesce(round(avg(melhor), 1), 0)                                  as media,
                  coalesce(percentile_disc(0.5) within group (order by melhor), 0)::int as mediana,
                  coalesce(percentile_disc(0.9) within group (order by melhor), 0)::int as p90
           from melhores`,
          [clave ?? null, intervalo]
        ),
        q(
          // Empate resolvido por quem chegou aquela pontuacao primeiro.
          `with melhores as (${melhoresPorJogador})
           select j.id, j.apelido, j.avatar, m.melhor::int as melhor
           from melhores m
           join jogadores j on j.id = m.jogador_id
           order by m.melhor desc, m.primeira asc
           limit $3`,
          [clave ?? null, intervalo, limite]
        ),
      ]);

      const resultado = {
        clave: clave ?? 'todas',
        periodo,
        mostra_apelidos: config.rankingMostraApelidos,
        distribuicao: dist.rows[0],
        topo: topo.rows.map((r, i) =>
          config.rankingMostraApelidos
            ? { posicao: i + 1, jogador_id: r.id, apelido: r.apelido, avatar: r.avatar, melhor: r.melhor }
            : { posicao: i + 1, melhor: r.melhor }
        ),
        eu: null,
      };

      if (!jogador_id) return resultado;

      // Posicao do proprio jogador — so depois de confirmar que o perfil e dele.
      const jogador = await jogadorDoChamador(req.autenticado, jogador_id);
      if (!jogador) {
        return resposta.code(404).send({ erro: 'Jogador nao encontrado.' });
      }

      const { rows: eu } = await q(
        `with melhores as (${melhoresPorJogador}),
              minha as (select melhor from melhores where jogador_id = $3)
         select (select melhor from minha)::int                                    as minha_melhor,
                (select count(*) from melhores where melhor > (select melhor from minha))::int + 1
                                                                                  as posicao,
                (select count(*) from melhores)::int                              as total`,
        [clave ?? null, intervalo, jogador.id]
      );

      const e = eu[0];
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
    }
  );
}
