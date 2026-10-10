/**
 * Service worker: deixa o jogo abrir sem internet depois da primeira visita,
 * que e o que faz o "Adicionar a tela inicial" se comportar como app.
 *
 * - API (/v1/*, /health): nunca passa pelo cache.
 * - Codigo e paginas: rede primeiro (sempre a versao nova quando ha internet),
 *   cache como reserva para jogar offline.
 * - Sons e icones: cache primeiro (nao mudam; economiza dados).
 *
 * Mudou a lista de arquivos ou a estrategia? Suba VERSAO para limpar o cache.
 */
const VERSAO = 'v1';
const CACHE_CODIGO = `adn-codigo-${VERSAO}`;
const CACHE_MIDIA = `adn-midia-${VERSAO}`;

const ESSENCIAIS = [
  './',
  'index.html',
  'config.js',
  'api.js',
  'instrumentos.js',
  'hinos.js',
  'quiz-perguntas.js',
  'quiz.js',
  'sugestoes.js',
  'game.js',
  'ui-conta.js',
  'manifest.webmanifest',
  'icones/icone-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE_CODIGO)
      // Um arquivo faltando nao pode impedir a instalacao.
      .then((c) => Promise.allSettled(ESSENCIAIS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes.filter((n) => n.startsWith('adn-') && n !== CACHE_CODIGO && n !== CACHE_MIDIA).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/v1/') || url.pathname.endsWith('/health')) return;

  const midia = /\/(sons|icones)\//.test(url.pathname);
  e.respondWith(midia ? cachePrimeiro(req) : redePrimeiro(req));
});

async function redePrimeiro(req) {
  const cache = await caches.open(CACHE_CODIGO);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (err) {
    const salvo = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (salvo) return salvo;
    throw err;
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(CACHE_MIDIA);
  const salvo = await cache.match(req);
  if (salvo) return salvo;
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return resp;
}
