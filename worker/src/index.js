/**
 * API do Aventura das Notas no Cloudflare Workers + D1.
 *
 * Porte do servidor Fastify/Postgres (server/). Mesmas rotas, mesmos formatos
 * de resposta e as mesmas regras de negocio; a validacao de apelido e de
 * plausibilidade de partida e importada direto de server/src/lib.
 *
 * Os arquivos do jogo (www/) sao servidos pelo proprio Workers como assets
 * estaticos (ver wrangler.jsonc). Este codigo so recebe o que nao e arquivo:
 * /health e /v1/*.
 */
import { lerConfig } from './config.js';
import { ErroHttp, falha, json, lerCorpo, validar } from './http.js';
import { autenticar, checarLimite, exigirAdmin } from './lib/acesso.js';

import rotasAuth from './routes/auth.js';
import rotasJogadores from './routes/jogadores.js';
import rotasPartidas from './routes/partidas.js';
import rotasRanking from './routes/ranking.js';
import rotasTurmas from './routes/turmas.js';
import rotasDenuncias from './routes/denuncias.js';
import rotasHinos from './routes/hinos.js';
import rotasSugestoes from './routes/sugestoes.js';

/**
 * Cada rota e { metodo, caminho, handler } mais, opcionalmente:
 *   auth:   true (conta ou aparelho) | 'conta' (so conta) | 'admin'
 *   limite: nome do binding de rate limit (padrao LIMITE_GLOBAL)
 *   corpo / query / params: schema de validacao
 */
const ROTAS = [
  {
    metodo: 'GET',
    caminho: '/health',
    async handler(c) {
      await c.db.prepare('select 1').first();
      return { ok: true, servico: 'aventura-das-notas-api', versao: '1.0.0' };
    },
  },
  ...rotasAuth,
  ...rotasJogadores,
  ...rotasPartidas,
  ...rotasRanking,
  ...rotasTurmas,
  ...rotasDenuncias,
  ...rotasHinos,
  ...rotasSugestoes,
].map((rota) => ({
  ...rota,
  // '/v1/jogadores/:id' -> /^\/v1\/jogadores\/(?<id>[^/]+)$/
  regex: new RegExp(
    '^' + rota.caminho.replace(/\//g, '\\/').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
  ),
}));

function encontrarRota(metodo, caminho) {
  for (const rota of ROTAS) {
    if (rota.metodo !== metodo) continue;
    const achou = rota.regex.exec(caminho);
    if (achou) return { rota, params: { ...achou.groups } };
  }
  return null;
}

// --- CORS ---------------------------------------------------------------
// O app Capacitor no Android usa origem https://localhost; no iOS,
// capacitor://localhost. O jogo servido pelo proprio Worker e mesma origem.
function cabecalhosCors(req, cfg) {
  const origem = req.headers.get('origin');
  if (!origem) return {};
  const liberada = cfg.corsOrigins.includes('*') || cfg.corsOrigins.includes(origem);
  return liberada ? { 'access-control-allow-origin': origem, vary: 'Origin' } : { vary: 'Origin' };
}

function preflight(req, cfg) {
  const cors = cabecalhosCors(req, cfg);
  if (!cors['access-control-allow-origin']) return new Response(null, { status: 204, headers: cors });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers':
        req.headers.get('access-control-request-headers') || 'authorization, content-type',
      'access-control-max-age': '86400',
    },
  });
}

async function atender(req, env, cfg) {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return preflight(req, cfg);

  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const encontrada = encontrarRota(req.method, url.pathname);

  const c = {
    req,
    env,
    cfg,
    db: env.DB,
    ip,
    userAgent: req.headers.get('user-agent') || '',
  };

  // Mesma ordem do Fastify: limite -> corpo -> validacao -> autenticacao -> rota.
  await checarLimite(c, encontrada?.rota.limite || 'LIMITE_GLOBAL');

  if (!encontrada) {
    throw falha(404, `Rota nao encontrada: ${req.method} ${url.pathname}${url.search}`);
  }
  const { rota, params } = encontrada;

  const corpo = await lerCorpo(req);
  c.params = rota.params ? validar(params, rota.params) : params;
  c.query = rota.query ? validar(Object.fromEntries(url.searchParams), rota.query) : {};
  c.corpo = rota.corpo ? validar(corpo ?? {}, rota.corpo) : corpo;

  if (rota.auth) c.auth = await autenticar(req, cfg, rota.auth !== true);
  if (rota.auth === 'admin') await exigirAdmin(c);

  const resultado = await rota.handler(c);
  return resultado instanceof Response ? resultado : json(resultado);
}

export default {
  async fetch(req, env) {
    let cfg;
    try {
      cfg = lerConfig(env);
    } catch (e) {
      console.error(e.message);
      return json({ erro: 'Servidor mal configurado.' }, 500);
    }

    let resposta;
    try {
      resposta = await atender(req, env, cfg);
    } catch (e) {
      if (e instanceof ErroHttp) {
        resposta = json(e.corpo, e.status);
      } else {
        console.error(JSON.stringify({ msg: 'erro nao tratado', erro: e?.message, stack: e?.stack }));
        // Nunca devolver stack trace nem mensagem interna ao cliente.
        resposta = json({ erro: 'Erro interno no servidor.' }, 500);
      }
    }

    for (const [nome, valor] of Object.entries(cabecalhosCors(req, cfg))) {
      resposta.headers.set(nome, valor);
    }
    return resposta;
  },
};
