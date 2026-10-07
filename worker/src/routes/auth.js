/** Cadastro, login, renovacao de sessao e identidade anonima de aparelho. */
import { json, falha } from '../http.js';
import { agora, executar, primeiro, todos, violouUnico } from '../db.js';
import {
  conferirSenha,
  gerarAccessToken,
  gerarHashSenha,
  hashIsca,
  sha256Hex,
  tokenAleatorio,
  validarForcaSenha,
} from '../lib/cripto.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Limite mais duro nas rotas de credencial: freia forca bruta.
const LIMITE_AUTH = 'LIMITE_AUTH';

/** Cria a sessao (refresh token) e devolve o par de tokens. */
async function abrirSessao(c, contaId) {
  const refresh = tokenAleatorio(32);
  const expira = new Date(Date.now() + c.cfg.refreshTokenTtlSeg * 1000).toISOString();

  await executar(
    c.db,
    `insert into sessoes (id, conta_id, token_hash, expira_em, user_agent)
     values (?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    contaId,
    await sha256Hex(refresh),
    expira,
    c.userAgent.slice(0, 300)
  );

  return {
    access_token: await gerarAccessToken(c.cfg, { sub: contaId, tipo: 'conta' }),
    refresh_token: refresh,
    expira_em_seg: c.cfg.accessTokenTtlSeg,
  };
}

export default [
  // -------------------------------------------------------------------------
  // Identidade anonima de aparelho: a crianca joga sem cadastro nenhum.
  // -------------------------------------------------------------------------
  {
    metodo: 'POST',
    caminho: '/v1/auth/dispositivo/registrar',
    limite: LIMITE_AUTH,
    corpo: {
      type: 'object',
      properties: { plataforma: { type: 'string', enum: ['android', 'ios', 'web'] } },
    },
    async handler(c) {
      const id = crypto.randomUUID();
      const segredo = tokenAleatorio(32);

      await executar(
        c.db,
        `insert into dispositivos (id, segredo_hash, plataforma, ultimo_acesso_em)
         values (?, ?, ?, ?)`,
        id,
        await sha256Hex(segredo),
        c.corpo.plataforma ?? null,
        agora()
      );

      return {
        // O cliente guarda os dois no armazenamento local do aparelho.
        dispositivo_id: id,
        segredo,
        access_token: await gerarAccessToken(c.cfg, { sub: id, tipo: 'dispositivo' }),
        expira_em_seg: c.cfg.accessTokenTtlSeg,
      };
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/auth/dispositivo/entrar',
    limite: LIMITE_AUTH,
    corpo: {
      type: 'object',
      required: ['dispositivo_id', 'segredo'],
      properties: {
        dispositivo_id: { type: 'string', format: 'uuid' },
        segredo: { type: 'string', minLength: 10, maxLength: 200 },
      },
    },
    async handler(c) {
      const { dispositivo_id, segredo } = c.corpo;

      const linha = await primeiro(
        c.db,
        `update dispositivos set ultimo_acesso_em = ?
         where id = ? and segredo_hash = ? returning id`,
        agora(),
        dispositivo_id,
        await sha256Hex(segredo)
      );
      if (!linha) throw falha(401, 'Aparelho nao reconhecido.');

      return {
        access_token: await gerarAccessToken(c.cfg, { sub: dispositivo_id, tipo: 'dispositivo' }),
        expira_em_seg: c.cfg.accessTokenTtlSeg,
      };
    },
  },

  // -------------------------------------------------------------------------
  // Conta do adulto responsavel
  // -------------------------------------------------------------------------
  {
    metodo: 'POST',
    caminho: '/v1/auth/cadastro',
    limite: LIMITE_AUTH,
    corpo: {
      type: 'object',
      required: ['email', 'senha', 'nome', 'responsavel_confirmado'],
      properties: {
        email: { type: 'string', maxLength: 254 },
        senha: { type: 'string', maxLength: 200 },
        nome: { type: 'string', maxLength: 80 },
        // Precisa vir true: declaracao de que quem cadastra e maior de idade e
        // responsavel pelos jogadores. Exigido pela LGPD Art. 14.
        responsavel_confirmado: { type: 'boolean' },
      },
    },
    async handler(c) {
      const email = String(c.corpo.email).trim().toLowerCase();
      const nome = String(c.corpo.nome).trim();
      const { senha, responsavel_confirmado } = c.corpo;

      if (!EMAIL_RE.test(email)) throw falha(400, 'E-mail invalido.');
      if (nome.length < 2) throw falha(400, 'Informe o nome do responsavel.');
      if (!responsavel_confirmado) {
        throw falha(
          400,
          'E preciso confirmar que voce e maior de idade e responsavel pelos jogadores cadastrados.'
        );
      }
      const problemaSenha = validarForcaSenha(senha);
      if (problemaSenha) throw falha(400, problemaSenha);

      const senhaHash = await gerarHashSenha(c.cfg, senha);

      let conta;
      try {
        conta = await primeiro(
          c.db,
          `insert into contas (id, email, senha_hash, nome, responsavel_confirmado, ultimo_acesso_em)
           values (?, ?, ?, ?, 1, ?)
           returning id, email, nome, criado_em`,
          crypto.randomUUID(),
          email,
          senhaHash,
          nome,
          agora()
        );
      } catch (e) {
        if (violouUnico(e)) throw falha(409, 'Ja existe uma conta com esse e-mail.');
        throw e;
      }

      const tokens = await abrirSessao(c, conta.id);
      return json({ conta, ...tokens }, 201);
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/auth/entrar',
    limite: LIMITE_AUTH,
    corpo: {
      type: 'object',
      required: ['email', 'senha'],
      properties: {
        email: { type: 'string', maxLength: 254 },
        senha: { type: 'string', maxLength: 200 },
      },
    },
    async handler(c) {
      const email = String(c.corpo.email).trim().toLowerCase();

      const conta = await primeiro(
        c.db,
        'select id, email, nome, senha_hash from contas where email = ?',
        email
      );

      // Mesma mensagem para e-mail inexistente e senha errada: nao revela quem
      // tem conta no servico.
      const generico = 'E-mail ou senha incorretos.';

      if (!conta) {
        await conferirSenha(c.corpo.senha, hashIsca(c.cfg));
        throw falha(401, generico);
      }
      if (!(await conferirSenha(c.corpo.senha, conta.senha_hash))) {
        throw falha(401, generico);
      }

      await executar(c.db, 'update contas set ultimo_acesso_em = ? where id = ?', agora(), conta.id);
      const tokens = await abrirSessao(c, conta.id);

      return { conta: { id: conta.id, email: conta.email, nome: conta.nome }, ...tokens };
    },
  },

  /**
   * Renovacao com rotacao: o refresh usado e revogado e um novo e emitido.
   *
   * O D1 nao tem transacao interativa (nem SELECT ... FOR UPDATE). A revogacao
   * e feita num unico UPDATE condicional com RETURNING: das requisicoes
   * concorrentes com o mesmo refresh, so uma consegue revogar e seguir.
   */
  {
    metodo: 'POST',
    caminho: '/v1/auth/renovar',
    limite: LIMITE_AUTH,
    corpo: {
      type: 'object',
      required: ['refresh_token'],
      properties: { refresh_token: { type: 'string', maxLength: 200 } },
    },
    async handler(c) {
      const instante = agora();
      const sessao = await primeiro(
        c.db,
        `update sessoes set revogada_em = ?1
         where token_hash = ?2 and revogada_em is null and expira_em > ?1
         returning conta_id`,
        instante,
        await sha256Hex(c.corpo.refresh_token)
      );
      if (!sessao) throw falha(401, 'Sessao expirada. Entre novamente.');

      return abrirSessao(c, sessao.conta_id);
    },
  },

  {
    metodo: 'POST',
    caminho: '/v1/auth/sair',
    corpo: {
      type: 'object',
      required: ['refresh_token'],
      properties: { refresh_token: { type: 'string', maxLength: 200 } },
    },
    async handler(c) {
      await executar(
        c.db,
        'update sessoes set revogada_em = ? where token_hash = ? and revogada_em is null',
        agora(),
        await sha256Hex(c.corpo.refresh_token)
      );
      return { ok: true };
    },
  },

  // -------------------------------------------------------------------------
  {
    metodo: 'GET',
    caminho: '/v1/eu',
    auth: true,
    async handler(c) {
      const { tipo, id } = c.auth;

      if (tipo === 'dispositivo') {
        const jogadores = await todos(
          c.db,
          `select id, apelido, avatar, instrumento, criado_em from jogadores
           where dispositivo_id = ? and conta_id is null order by criado_em`,
          id
        );
        return { tipo: 'dispositivo', dispositivo_id: id, conta: null, jogadores };
      }

      const [conta, jogadores] = await Promise.all([
        primeiro(c.db, 'select id, email, nome, criado_em from contas where id = ?', id),
        todos(
          c.db,
          `select id, apelido, avatar, instrumento, criado_em from jogadores
           where conta_id = ? order by criado_em`,
          id
        ),
      ]);
      return { tipo: 'conta', conta, jogadores };
    },
  },
];
