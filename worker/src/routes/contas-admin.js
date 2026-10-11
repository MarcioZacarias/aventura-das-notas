/**
 * Gestao de contas no painel do administrador: lista, ficha, edicao,
 * banimento, encerrar sessoes e exclusao (LGPD).
 *
 * Todas as rotas exigem conta de administrador (ADMIN_EMAILS). Uma conta de
 * administrador nao pode ser banida nem excluida por aqui, para ninguem se
 * trancar fora do painel por engano.
 */
import { falha } from '../http.js';
import { agora, executar, primeiro, todos } from '../db.js';
import { ehEmailAdmin } from '../lib/acesso.js';
import { validarApelido } from '../../../server/src/lib/apelido.js';

const POR_PAGINA = 50;
const paramUuid = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } };

async function contaOu404(c, id) {
  const conta = await primeiro(
    c.db,
    `select id, email, nome, criado_em, ultimo_acesso_em, banida_em, ban_motivo
     from contas where id = ?`,
    id
  );
  if (!conta) throw falha(404, 'Conta não encontrada.');
  return conta;
}

/** Fecha todas as sessoes abertas da conta (refresh tokens). */
const revogarSessoes = (c, contaId) =>
  executar(
    c.db,
    'update sessoes set revogada_em = ? where conta_id = ? and revogada_em is null',
    agora(),
    contaId
  );

export default [
  {
    metodo: 'GET',
    caminho: '/v1/admin/contas',
    auth: 'admin',
    query: {
      type: 'object',
      properties: {
        busca: { type: 'string', maxLength: 120 },
        situacao: { type: 'string', enum: ['todas', 'ativas', 'banidas'], default: 'todas' },
        pagina: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
      },
    },
    async handler(c) {
      const busca = (c.query.busca || '').trim().toLowerCase();
      const filtro = busca ? `%${busca.replace(/[%_]/g, '')}%` : null;
      const situacao = c.query.situacao;
      const offset = (c.query.pagina - 1) * POR_PAGINA;

      const onde = `where (?1 is null or lower(ct.nome) like ?1 or ct.email like ?1
                           or exists (select 1 from jogadores jj where jj.conta_id = ct.id and lower(jj.apelido) like ?1))
                      and (?2 = 'todas' or (?2 = 'banidas') = (ct.banida_em is not null))`;

      const [{ total }, linhas, resumo] = await Promise.all([
        primeiro(c.db, `select count(*) as total from contas ct ${onde}`, filtro, situacao),
        todos(
          c.db,
          `select ct.id, ct.nome, ct.email, ct.criado_em, ct.ultimo_acesso_em, ct.banida_em,
                  (select count(*) from jogadores j where j.conta_id = ct.id) as jogadores,
                  (select count(*) from partidas p join jogadores j on j.id = p.jogador_id
                    where j.conta_id = ct.id) as partidas,
                  (select group_concat(apelido, ', ') from jogadores j where j.conta_id = ct.id) as apelidos
           from contas ct ${onde}
           order by ct.criado_em desc
           limit ?3 offset ?4`,
          filtro,
          situacao,
          POR_PAGINA,
          offset
        ),
        primeiro(
          c.db,
          `select (select count(*) from contas) as contas,
                  (select count(*) from contas where banida_em is not null) as banidas,
                  (select count(*) from jogadores) as jogadores,
                  (select count(*) from dispositivos) as aparelhos,
                  (select count(*) from contas where ultimo_acesso_em > ?) as ativas_7_dias`,
          new Date(Date.now() - 7 * 86400000).toISOString()
        ),
      ]);

      return {
        resumo,
        total,
        pagina: c.query.pagina,
        por_pagina: POR_PAGINA,
        contas: linhas.map((l) => ({ ...l, admin: ehEmailAdmin(c.cfg, l.email) })),
      };
    },
  },

  {
    metodo: 'GET',
    caminho: '/v1/admin/contas/:id',
    auth: 'admin',
    params: paramUuid,
    async handler(c) {
      const conta = await contaOu404(c, c.params.id);
      const [jogadores, sessoes, turmas, sugestoes] = await Promise.all([
        todos(
          c.db,
          `select j.id, j.apelido, j.instrumento, j.criado_em,
                  count(p.id) as partidas, max(p.pontuacao) as recorde, max(p.jogada_em) as ultima_partida
           from jogadores j left join partidas p on p.jogador_id = j.id
           where j.conta_id = ?
           group by j.id order by j.criado_em`,
          conta.id
        ),
        primeiro(
          c.db,
          `select count(*) as abertas, max(criado_em) as ultima
           from sessoes where conta_id = ? and revogada_em is null and expira_em > ?`,
          conta.id,
          agora()
        ),
        todos(c.db, 'select id, nome, codigo, criado_em from turmas where dono_conta_id = ? order by criado_em', conta.id),
        primeiro(c.db, 'select count(*) as total from sugestoes where conta_id = ?', conta.id),
      ]);
      return {
        conta: { ...conta, admin: ehEmailAdmin(c.cfg, conta.email) },
        jogadores,
        sessoes_abertas: sessoes.abertas,
        turmas,
        sugestoes: sugestoes.total,
      };
    },
  },

  /** Edita nome, bane ou desbane. */
  {
    metodo: 'PATCH',
    caminho: '/v1/admin/contas/:id',
    auth: 'admin',
    params: paramUuid,
    corpo: {
      type: 'object',
      properties: {
        nome: { type: 'string', minLength: 2, maxLength: 80 },
        banida: { type: 'boolean' },
        motivo: { type: 'string', maxLength: 300, anyOfVazio: true },
      },
    },
    async handler(c) {
      const conta = await contaOu404(c, c.params.id);
      const { nome, banida, motivo } = c.corpo;

      if (nome !== undefined) {
        const n = nome.trim();
        if (n.length < 2) throw falha(400, 'Nome muito curto.');
        await executar(c.db, 'update contas set nome = ? where id = ?', n, conta.id);
      }

      if (banida === true) {
        if (ehEmailAdmin(c.cfg, conta.email)) throw falha(400, 'Não é possível banir uma conta de administrador.');
        await executar(
          c.db,
          'update contas set banida_em = coalesce(banida_em, ?), ban_motivo = ? where id = ?',
          agora(),
          (motivo || '').trim() || null,
          conta.id
        );
        await revogarSessoes(c, conta.id);
      } else if (banida === false) {
        await executar(c.db, 'update contas set banida_em = null, ban_motivo = null where id = ?', conta.id);
      } else if (motivo !== undefined && conta.banida_em) {
        await executar(c.db, 'update contas set ban_motivo = ? where id = ?', motivo.trim() || null, conta.id);
      }

      return { conta: await contaOu404(c, conta.id) };
    },
  },

  /** Desconecta a conta de todos os aparelhos (ela precisa entrar de novo). */
  {
    metodo: 'POST',
    caminho: '/v1/admin/contas/:id/encerrar-sessoes',
    auth: 'admin',
    params: paramUuid,
    async handler(c) {
      const conta = await contaOu404(c, c.params.id);
      const r = await revogarSessoes(c, conta.id);
      return { ok: true, encerradas: r.meta?.changes ?? 0 };
    },
  },

  /** Exclui a conta e tudo dela (perfis, partidas, turmas). Irreversivel. */
  {
    metodo: 'DELETE',
    caminho: '/v1/admin/contas/:id',
    auth: 'admin',
    params: paramUuid,
    corpo: {
      type: 'object',
      required: ['confirmar_email'],
      properties: { confirmar_email: { type: 'string', maxLength: 254 } },
    },
    async handler(c) {
      const conta = await contaOu404(c, c.params.id);
      if (ehEmailAdmin(c.cfg, conta.email)) throw falha(400, 'Não é possível excluir uma conta de administrador.');
      if (c.corpo.confirmar_email.trim().toLowerCase() !== conta.email) {
        throw falha(400, 'Para confirmar, digite exatamente o e-mail da conta.');
      }
      // Cascade apaga sessoes, jogadores (e partidas/turma_membros), turmas e sugestoes.
      await executar(c.db, 'delete from contas where id = ?', conta.id);
      return { ok: true };
    },
  },

  /** Moderacao: troca o apelido de um perfil (ex.: apelido ofensivo). */
  {
    metodo: 'PATCH',
    caminho: '/v1/admin/jogadores/:id',
    auth: 'admin',
    params: paramUuid,
    corpo: {
      type: 'object',
      required: ['apelido'],
      properties: { apelido: { type: 'string', minLength: 2, maxLength: 20 } },
    },
    async handler(c) {
      const apelido = c.corpo.apelido.trim();
      const problema = validarApelido(apelido);
      if (problema) throw falha(400, problema);
      const jogador = await primeiro(
        c.db,
        'update jogadores set apelido = ? where id = ? returning id, apelido',
        apelido,
        c.params.id
      );
      if (!jogador) throw falha(404, 'Perfil não encontrado.');
      return { jogador };
    },
  },
];
