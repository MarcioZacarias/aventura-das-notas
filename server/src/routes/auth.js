/** Cadastro, login, renovacao de sessao e identidade anonima de aparelho. */
import { randomBytes, createHash } from 'node:crypto';
import { q, transacao } from '../db.js';
import { config } from '../config.js';
import { gerarHash, conferirSenha, validarForcaSenha } from '../lib/senha.js';
import { gerarAccessToken, gerarRefreshToken, hashRefreshToken } from '../lib/tokens.js';
import { exigirAuth } from '../lib/autenticacao.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNIQUE_VIOLATION = '23505';

// Hash descartavel, usado para gastar tempo de CPU quando o e-mail nao existe.
// Sem isso, um login com e-mail inexistente responde muito mais rapido que um
// com senha errada, e isso permite descobrir quem tem conta no servico.
const HASH_ISCA =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Cria a sessao (refresh token) e devolve o par de tokens. */
async function abrirSessao(contaId, userAgent) {
  const refresh = gerarRefreshToken();
  const expira = new Date(Date.now() + config.refreshTokenTtlSeg * 1000);

  await q(
    `insert into sessoes (conta_id, token_hash, expira_em, user_agent)
     values ($1, $2, $3, $4)`,
    [contaId, refresh.hash, expira, (userAgent || '').slice(0, 300)]
  );

  return {
    access_token: gerarAccessToken({ sub: contaId, tipo: 'conta' }),
    refresh_token: refresh.valor,
    expira_em_seg: config.accessTokenTtlSeg,
  };
}

export default async function rotasAuth(app) {
  // Limite mais duro nas rotas de credencial: freia forca bruta.
  const limiteAuth = { config: { rateLimit: { max: config.limiteAuth, timeWindow: '5 minutes' } } };

  // -------------------------------------------------------------------------
  // Identidade anonima de aparelho: a crianca joga sem cadastro nenhum.
  // -------------------------------------------------------------------------
  app.post(
    '/auth/dispositivo/registrar',
    {
      ...limiteAuth,
      schema: {
        body: {
          type: 'object',
          properties: { plataforma: { type: 'string', enum: ['android', 'ios', 'web'] } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const segredo = randomBytes(32).toString('base64url');
      const hash = createHash('sha256').update(segredo).digest('hex');

      const { rows } = await q(
        `insert into dispositivos (segredo_hash, plataforma, ultimo_acesso_em)
         values ($1, $2, now()) returning id`,
        [hash, req.body?.plataforma ?? null]
      );
      const id = rows[0].id;

      return {
        // O cliente guarda os dois no armazenamento local do aparelho.
        dispositivo_id: id,
        segredo,
        access_token: gerarAccessToken({ sub: id, tipo: 'dispositivo' }),
        expira_em_seg: config.accessTokenTtlSeg,
      };
    }
  );

  app.post(
    '/auth/dispositivo/entrar',
    {
      ...limiteAuth,
      schema: {
        body: {
          type: 'object',
          required: ['dispositivo_id', 'segredo'],
          properties: {
            dispositivo_id: { type: 'string', format: 'uuid' },
            segredo: { type: 'string', minLength: 10, maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const { dispositivo_id, segredo } = req.body;
      const hash = createHash('sha256').update(segredo).digest('hex');

      const { rows } = await q(
        `update dispositivos set ultimo_acesso_em = now()
         where id = $1 and segredo_hash = $2 returning id`,
        [dispositivo_id, hash]
      );
      if (!rows.length) return resposta.code(401).send({ erro: 'Aparelho nao reconhecido.' });

      return {
        access_token: gerarAccessToken({ sub: dispositivo_id, tipo: 'dispositivo' }),
        expira_em_seg: config.accessTokenTtlSeg,
      };
    }
  );

  // -------------------------------------------------------------------------
  // Conta do adulto responsavel
  // -------------------------------------------------------------------------
  app.post(
    '/auth/cadastro',
    {
      ...limiteAuth,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'senha', 'nome', 'responsavel_confirmado'],
          properties: {
            email: { type: 'string', maxLength: 254 },
            senha: { type: 'string', maxLength: 200 },
            nome: { type: 'string', maxLength: 80 },
            // Precisa vir true: e a declaracao de que quem cadastra e maior de
            // idade e responsavel pelos jogadores. Exigido pela LGPD Art. 14.
            responsavel_confirmado: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const email = String(req.body.email).trim().toLowerCase();
      const nome = String(req.body.nome).trim();
      const { senha, responsavel_confirmado } = req.body;

      if (!EMAIL_RE.test(email)) return resposta.code(400).send({ erro: 'E-mail invalido.' });
      if (nome.length < 2) {
        return resposta.code(400).send({ erro: 'Informe o nome do responsavel.' });
      }
      if (!responsavel_confirmado) {
        return resposta.code(400).send({
          erro:
            'E preciso confirmar que voce e maior de idade e responsavel pelos jogadores cadastrados.',
        });
      }
      const problemaSenha = validarForcaSenha(senha);
      if (problemaSenha) return resposta.code(400).send({ erro: problemaSenha });

      const senhaHash = await gerarHash(senha);

      let conta;
      try {
        const { rows } = await q(
          `insert into contas (email, senha_hash, nome, responsavel_confirmado, ultimo_acesso_em)
           values ($1, $2, $3, true, now())
           returning id, email, nome, criado_em`,
          [email, senhaHash, nome]
        );
        conta = rows[0];
      } catch (e) {
        if (e.code === UNIQUE_VIOLATION) {
          return resposta.code(409).send({ erro: 'Ja existe uma conta com esse e-mail.' });
        }
        throw e;
      }

      const tokens = await abrirSessao(conta.id, req.headers['user-agent']);
      return resposta.code(201).send({ conta, ...tokens });
    }
  );

  app.post(
    '/auth/entrar',
    {
      ...limiteAuth,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'senha'],
          properties: {
            email: { type: 'string', maxLength: 254 },
            senha: { type: 'string', maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const email = String(req.body.email).trim().toLowerCase();

      const { rows } = await q(
        'select id, email, nome, senha_hash from contas where email = $1',
        [email]
      );
      const conta = rows[0];

      // Mesma mensagem para e-mail inexistente e senha errada: nao revela
      // quem tem conta no servico.
      const generico = { erro: 'E-mail ou senha incorretos.' };

      if (!conta) {
        await conferirSenha(req.body.senha, HASH_ISCA);
        return resposta.code(401).send(generico);
      }
      if (!(await conferirSenha(req.body.senha, conta.senha_hash))) {
        return resposta.code(401).send(generico);
      }

      await q('update contas set ultimo_acesso_em = now() where id = $1', [conta.id]);
      const tokens = await abrirSessao(conta.id, req.headers['user-agent']);

      return { conta: { id: conta.id, email: conta.email, nome: conta.nome }, ...tokens };
    }
  );

  /**
   * Renovacao com rotacao: o refresh usado e revogado e um novo e emitido.
   * Assim um refresh token vazado tem janela curta de uso.
   */
  app.post(
    '/auth/renovar',
    {
      ...limiteAuth,
      schema: {
        body: {
          type: 'object',
          required: ['refresh_token'],
          properties: { refresh_token: { type: 'string', maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const hash = hashRefreshToken(req.body.refresh_token);

      return transacao(async (c) => {
        const { rows } = await c.query(
          `select id, conta_id from sessoes
           where token_hash = $1 and revogada_em is null and expira_em > now()
           for update`,
          [hash]
        );
        if (!rows.length) {
          return resposta.code(401).send({ erro: 'Sessao expirada. Entre novamente.' });
        }
        const sessao = rows[0];

        await c.query('update sessoes set revogada_em = now() where id = $1', [sessao.id]);

        const novo = gerarRefreshToken();
        await c.query(
          `insert into sessoes (conta_id, token_hash, expira_em, user_agent)
           values ($1, $2, $3, $4)`,
          [
            sessao.conta_id,
            novo.hash,
            new Date(Date.now() + config.refreshTokenTtlSeg * 1000),
            (req.headers['user-agent'] || '').slice(0, 300),
          ]
        );

        return {
          access_token: gerarAccessToken({ sub: sessao.conta_id, tipo: 'conta' }),
          refresh_token: novo.valor,
          expira_em_seg: config.accessTokenTtlSeg,
        };
      });
    }
  );

  app.post(
    '/auth/sair',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refresh_token'],
          properties: { refresh_token: { type: 'string', maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      await q(
        'update sessoes set revogada_em = now() where token_hash = $1 and revogada_em is null',
        [hashRefreshToken(req.body.refresh_token)]
      );
      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  app.get('/eu', { preHandler: exigirAuth }, async (req) => {
    const { tipo, id } = req.autenticado;

    if (tipo === 'dispositivo') {
      const { rows } = await q(
        `select id, apelido, avatar, criado_em from jogadores
         where dispositivo_id = $1 and conta_id is null order by criado_em`,
        [id]
      );
      return { tipo: 'dispositivo', dispositivo_id: id, conta: null, jogadores: rows };
    }

    const [conta, jogadores] = await Promise.all([
      q('select id, email, nome, criado_em from contas where id = $1', [id]),
      q(
        `select id, apelido, avatar, criado_em from jogadores
         where conta_id = $1 order by criado_em`,
        [id]
      ),
    ]);
    return { tipo: 'conta', conta: conta.rows[0], jogadores: jogadores.rows };
  });
}
