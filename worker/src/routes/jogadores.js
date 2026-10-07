/**
 * Perfis de jogador. Sao os perfis das criancas: apelido e avatar, nada mais.
 * Nenhum dado pessoal e coletado aqui.
 */
import { json, falha } from '../http.js';
import { executar, primeiro, todos } from '../db.js';
import { colunaDono, exigirJogador } from '../lib/acesso.js';
import { sha256Hex } from '../lib/cripto.js';
import { validarApelido } from '../../../server/src/lib/apelido.js';

const MAX_JOGADORES = 10;

// Formato igual ao CHECK da migration 0003. O catalogo fica no cliente.
const INSTRUMENTO = { type: 'string', minLength: 2, maxLength: 32, pattern: '^[a-z_]+$' };

const paramId = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
};

export default [
  {
    metodo: 'GET',
    caminho: '/v1/jogadores',
    auth: true,
    async handler(c) {
      const jogadores = await todos(
        c.db,
        `select id, apelido, avatar, instrumento, criado_em from jogadores
         where ${colunaDono(c.auth)} = ? order by criado_em`,
        c.auth.id
      );
      return { jogadores };
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/jogadores',
    auth: true,
    corpo: {
      type: 'object',
      required: ['apelido'],
      properties: {
        apelido: { type: 'string', minLength: 2, maxLength: 20 },
        avatar: { type: 'string', maxLength: 16 },
        instrumento: INSTRUMENTO,
      },
    },
    async handler(c) {
      const apelido = c.corpo.apelido.trim();
      const avatar = (c.corpo.avatar || 'musica').trim();

      // O apelido fica visivel no ranking geral, entao passa pela moderacao.
      const problema = validarApelido(apelido);
      if (problema) throw falha(400, problema);

      const coluna = colunaDono(c.auth);

      const { total } = await primeiro(
        c.db,
        `select count(*) as total from jogadores where ${coluna} = ?`,
        c.auth.id
      );
      if (total >= MAX_JOGADORES) throw falha(409, `Limite de ${MAX_JOGADORES} jogadores atingido.`);

      const jogador = await primeiro(
        c.db,
        `insert into jogadores (id, ${coluna}, apelido, avatar, instrumento)
         values (?, ?, ?, ?, ?) returning id, apelido, avatar, instrumento, criado_em`,
        crypto.randomUUID(),
        c.auth.id,
        apelido,
        avatar,
        c.corpo.instrumento ?? null
      );
      return json({ jogador }, 201);
    },
  },

  {
    metodo: 'PATCH',
    caminho: '/v1/jogadores/:id',
    auth: true,
    params: paramId,
    corpo: {
      type: 'object',
      properties: {
        apelido: { type: 'string', minLength: 2, maxLength: 20 },
        avatar: { type: 'string', maxLength: 16 },
        // Id do catalogo em instrumentos.js. Ausente = nao muda.
        instrumento: INSTRUMENTO,
      },
    },
    async handler(c) {
      const jogador = await exigirJogador(c, c.params.id);

      const apelido = c.corpo.apelido?.trim() ?? jogador.apelido;
      const avatar = c.corpo.avatar?.trim() ?? jogador.avatar;
      const instrumento = c.corpo.instrumento ?? jogador.instrumento;

      if (apelido !== jogador.apelido) {
        const problema = validarApelido(apelido);
        if (problema) throw falha(400, problema);
      }

      const atualizado = await primeiro(
        c.db,
        `update jogadores set apelido = ?, avatar = ?, instrumento = ?
         where id = ? returning id, apelido, avatar, instrumento, criado_em`,
        apelido,
        avatar,
        instrumento,
        jogador.id
      );
      return { jogador: atualizado };
    },
  },

  {
    metodo: 'DELETE',
    caminho: '/v1/jogadores/:id',
    auth: true,
    params: paramId,
    async handler(c) {
      const jogador = await exigirJogador(c, c.params.id);
      // Cascade apaga partidas e vinculos de turma junto.
      await executar(c.db, 'delete from jogadores where id = ?', jogador.id);
      return { ok: true };
    },
  },

  /**
   * "Adocao" do perfil anonimo por uma conta.
   *
   * Cenario: a crianca jogou meses sem cadastro; depois o responsavel cria
   * conta e quer levar o historico. O cliente esta logado na conta E ainda
   * guarda as credenciais do aparelho, entao provamos as duas posses de uma vez.
   */
  {
    metodo: 'POST',
    caminho: '/v1/jogadores/vincular',
    auth: 'conta',
    corpo: {
      type: 'object',
      required: ['dispositivo_id', 'segredo'],
      properties: {
        dispositivo_id: { type: 'string', format: 'uuid' },
        segredo: { type: 'string', minLength: 10, maxLength: 200 },
        // Opcional: vincula so um jogador. Sem isso, vincula todos do aparelho.
        jogador_id: { type: 'string', format: 'uuid' },
      },
    },
    async handler(c) {
      const contaId = c.auth.id;
      const { dispositivo_id, segredo, jogador_id } = c.corpo;

      const disp = await primeiro(
        c.db,
        'select id from dispositivos where id = ? and segredo_hash = ?',
        dispositivo_id,
        await sha256Hex(segredo)
      );
      if (!disp) throw falha(401, 'Credenciais do aparelho invalidas.');

      const { total } = await primeiro(
        c.db,
        'select count(*) as total from jogadores where conta_id = ?',
        contaId
      );
      const disponiveis = MAX_JOGADORES - total;
      if (disponiveis <= 0) {
        throw falha(409, `Limite de ${MAX_JOGADORES} jogadores na conta atingido.`);
      }

      const params = [contaId, dispositivo_id];
      const filtroJogador = jogador_id ? 'and id = ?' : '';
      if (jogador_id) params.push(jogador_id);
      params.push(disponiveis);

      const jogadores = await todos(
        c.db,
        `update jogadores set conta_id = ?
         where id in (
           select id from jogadores
           where dispositivo_id = ? and conta_id is null ${filtroJogador}
           order by criado_em
           limit ?
         )
         returning id, apelido, avatar, instrumento, criado_em`,
        ...params
      );
      return { vinculados: jogadores.length, jogadores };
    },
  },
];
