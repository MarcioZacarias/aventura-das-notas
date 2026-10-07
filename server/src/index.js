/** Bootstrap da API do Aventura das Notas. */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { config } from './config.js';
import { pool, esperarBanco } from './db.js';
import { migrar } from './migrate.js';

import rotasAuth from './routes/auth.js';
import rotasJogadores from './routes/jogadores.js';
import rotasPartidas from './routes/partidas.js';
import rotasRanking from './routes/ranking.js';
import rotasTurmas from './routes/turmas.js';
import rotasDenuncias from './routes/denuncias.js';

const app = Fastify({
  logger: config.ehProducao
    ? { level: 'info' }
    : { level: 'info', transport: undefined },
  // Confia no X-Forwarded-For quando ha proxy (nginx/caddy) na frente, para o
  // rate limit ver o IP real do cliente e nao o do proxy.
  trustProxy: true,
  bodyLimit: 32 * 1024,
});

// --- CORS ---------------------------------------------------------------
// O app Capacitor no Android usa origem https://localhost; no iOS,
// capacitor://localhost. O jogo no navegador usa o host da LAN.
await app.register(cors, {
  origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: false,
});

// --- Rate limit global --------------------------------------------------
await app.register(rateLimit, {
  max: config.limiteGlobal,
  timeWindow: '1 minute',
  // Chave por IP; rotas sensiveis apertam o limite via config.rateLimit.
  keyGenerator: (req) => req.ip,
});

// --- Tratamento de erro -------------------------------------------------
app.setErrorHandler((erro, req, resposta) => {
  // Erros de validacao do schema do Fastify.
  if (erro.validation) {
    return resposta.code(400).send({
      erro: 'Dados invalidos.',
      detalhes: erro.validation.map((v) => `${v.instancePath || 'corpo'} ${v.message}`),
    });
  }
  if (erro.statusCode && erro.statusCode < 500) {
    return resposta.code(erro.statusCode).send({ erro: erro.message });
  }

  req.log.error({ err: erro }, 'erro nao tratado');
  // Nunca devolver stack trace nem mensagem interna ao cliente.
  return resposta.code(500).send({ erro: 'Erro interno no servidor.' });
});

app.setNotFoundHandler((req, resposta) => {
  resposta.code(404).send({ erro: `Rota nao encontrada: ${req.method} ${req.url}` });
});

// --- Rotas --------------------------------------------------------------
app.get('/health', async () => {
  await pool.query('select 1');
  return { ok: true, servico: 'aventura-das-notas-api', versao: '1.0.0' };
});

await app.register(
  async (api) => {
    await api.register(rotasAuth);
    await api.register(rotasJogadores);
    await api.register(rotasPartidas);
    await api.register(rotasRanking);
    await api.register(rotasTurmas);
    await api.register(rotasDenuncias);
  },
  { prefix: '/v1' }
);

// --- Sobe ---------------------------------------------------------------
try {
  await esperarBanco();
  await migrar();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API ouvindo em http://${config.host}:${config.port}`);
} catch (e) {
  app.log.error(e, 'falha ao iniciar');
  process.exit(1);
}

// Encerramento limpo: para de aceitar conexoes e fecha o pool.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, async () => {
    app.log.info(`${sinal} recebido, encerrando...`);
    try {
      await app.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
}
