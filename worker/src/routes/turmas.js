/**
 * Turmas: o substituto de "amizade entre jogadores".
 *
 * Um adulto cria a turma e distribui um codigo de 6 caracteres. So quem recebe
 * o codigo entra. O ranking com apelidos acontece apenas aqui dentro — grupo
 * fechado, com um responsavel identificado como dono.
 */
import { json, falha } from '../http.js';
import { diasAtras, executar, primeiro, todos, violouUnico } from '../db.js';
import { colunaDono, exigirJogador } from '../lib/acesso.js';
import { bytesAleatorios } from '../lib/cripto.js';

// Alfabeto sem caracteres ambiguos (sem I, O, 0, 1): o codigo e ditado em voz
// alta ou copiado a mao por criancas. Precisa casar com o CHECK da migration.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAM_CODIGO = 6;
const MAX_TURMAS_POR_CONTA = 20;

// 32 divide 256, entao byte % 32 e uniforme (sem vies de modulo).
function gerarCodigo() {
  return Array.from(bytesAleatorios(TAM_CODIGO), (b) => ALFABETO[b % ALFABETO.length]).join('');
}

const DIAS_DO_PERIODO = { semana: 7, mes: 30 };

export default [
  {
    metodo: 'POST',
    caminho: '/v1/turmas',
    auth: 'conta',
    corpo: {
      type: 'object',
      required: ['nome'],
      properties: { nome: { type: 'string', minLength: 2, maxLength: 60 } },
    },
    async handler(c) {
      const contaId = c.auth.id;
      const nome = c.corpo.nome.trim();

      const { total } = await primeiro(
        c.db,
        'select count(*) as total from turmas where dono_conta_id = ?',
        contaId
      );
      if (total >= MAX_TURMAS_POR_CONTA) {
        throw falha(409, `Limite de ${MAX_TURMAS_POR_CONTA} turmas atingido.`);
      }

      // 32^6 = ~1 bilhao de codigos; colisao e rara, mas tratada.
      for (let tentativa = 0; tentativa < 8; tentativa++) {
        try {
          const turma = await primeiro(
            c.db,
            `insert into turmas (id, dono_conta_id, nome, codigo)
             values (?, ?, ?, ?) returning id, nome, codigo, criado_em`,
            crypto.randomUUID(),
            contaId,
            nome,
            gerarCodigo()
          );
          return json({ turma }, 201);
        } catch (e) {
          if (!violouUnico(e)) throw e;
        }
      }
      throw falha(503, 'Nao foi possivel gerar um codigo de turma. Tente de novo.');
    },
  },

  /** Turmas que eu administro + turmas em que meus jogadores estao. */
  {
    metodo: 'GET',
    caminho: '/v1/turmas',
    auth: true,
    async handler(c) {
      const { tipo, id } = c.auth;

      const administro =
        tipo === 'conta'
          ? await todos(
              c.db,
              `select t.id, t.nome, t.codigo, t.criado_em,
                      (select count(*) from turma_membros m where m.turma_id = t.id) as membros
               from turmas t where t.dono_conta_id = ? order by t.criado_em`,
              id
            )
          : [];

      const participando = await todos(
        c.db,
        `select distinct t.id, t.nome, t.criado_em, m.jogador_id
         from turmas t
         join turma_membros m on m.turma_id = t.id
         join jogadores j on j.id = m.jogador_id
         where j.${colunaDono(c.auth)} = ?
         order by t.criado_em`,
        id
      );

      return { administro, participando };
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/turmas/entrar',
    auth: true,
    limite: 'LIMITE_TURMA',
    corpo: {
      type: 'object',
      required: ['codigo', 'jogador_id'],
      properties: {
        codigo: { type: 'string', minLength: 6, maxLength: 6 },
        jogador_id: { type: 'string', format: 'uuid' },
      },
    },
    async handler(c) {
      const jogador = await exigirJogador(c, c.corpo.jogador_id);
      const codigo = c.corpo.codigo.trim().toUpperCase();

      const turma = await primeiro(c.db, 'select id, nome from turmas where codigo = ?', codigo);
      if (!turma) throw falha(404, 'Codigo de turma invalido.');

      await executar(
        c.db,
        `insert into turma_membros (turma_id, jogador_id) values (?, ?)
         on conflict (turma_id, jogador_id) do nothing`,
        turma.id,
        jogador.id
      );

      return { ok: true, turma: { id: turma.id, nome: turma.nome } };
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/turmas/sair',
    auth: true,
    corpo: {
      type: 'object',
      required: ['turma_id', 'jogador_id'],
      properties: {
        turma_id: { type: 'string', format: 'uuid' },
        jogador_id: { type: 'string', format: 'uuid' },
      },
    },
    async handler(c) {
      const jogador = await exigirJogador(c, c.corpo.jogador_id);
      await executar(
        c.db,
        'delete from turma_membros where turma_id = ? and jogador_id = ?',
        c.corpo.turma_id,
        jogador.id
      );
      return { ok: true };
    },
  },

  /**
   * Ranking da turma — aqui os apelidos APARECEM, porque e grupo fechado com
   * dono responsavel. Acesso permitido ao dono da turma ou a quem tem um
   * jogador dentro dela.
   */
  {
    metodo: 'GET',
    caminho: '/v1/turmas/:id/ranking',
    auth: true,
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
    },
    query: {
      type: 'object',
      properties: {
        clave: { type: 'string', enum: ['sol', 'fa', 'do'] },
        periodo: { type: 'string', enum: ['semana', 'mes', 'todos'], default: 'todos' },
      },
    },
    async handler(c) {
      const turmaId = c.params.id;
      const { tipo, id: autorId } = c.auth;

      const permissao = await primeiro(
        c.db,
        `select
           exists(select 1 from turmas where id = ?1 and dono_conta_id = ?2) as sou_dono,
           exists(
             select 1 from turma_membros m
             join jogadores j on j.id = m.jogador_id
             where m.turma_id = ?1 and j.${colunaDono(c.auth)} = ?3
           ) as tenho_jogador`,
        turmaId,
        tipo === 'conta' ? autorId : null,
        autorId
      );

      if (!permissao.sou_dono && !permissao.tenho_jogador) {
        throw falha(404, 'Turma nao encontrada.');
      }

      const dias = DIAS_DO_PERIODO[c.query.periodo];
      const corte = dias ? diasAtras(dias) : null;

      const linhas = await todos(
        c.db,
        `select j.id, j.apelido, j.avatar,
                max(p.pontuacao) as melhor,
                count(p.id)      as partidas,
                max(p.jogada_em) as ultima
         from turma_membros m
         join jogadores j on j.id = m.jogador_id
         left join partidas p on p.jogador_id = j.id
              and (?2 is null or p.clave = ?2)
              and (?3 is null or p.jogada_em > ?3)
         where m.turma_id = ?1
         group by j.id, j.apelido, j.avatar
         order by melhor desc nulls last, partidas desc, j.apelido`,
        turmaId,
        c.query.clave ?? null,
        corte
      );

      return {
        turma_id: turmaId,
        clave: c.query.clave ?? 'todas',
        periodo: c.query.periodo,
        ranking: linhas.map((r, i) => ({ posicao: i + 1, ...r })),
      };
    },
  },
];
