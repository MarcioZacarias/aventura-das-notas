/**
 * Servidor de desenvolvimento para testar o jogo no celular pela rede local.
 *
 * Escuta em 0.0.0.0 (nao so em localhost), imprime as URLs de acesso e serve os
 * arquivos da raiz do repositorio. Sem dependencias.
 *
 *   node scripts/dev-server.mjs [porta]
 *
 * config.js e servido DINAMICAMENTE: o arquivo da raiz tem apiBase vazio (modo
 * offline, que e o certo para o app publicado), mas em desenvolvimento a gente
 * quer falar com a API local. Por padrao apontamos para a porta 3000 do mesmo
 * host que atendeu a requisicao — assim funciona tanto em localhost quanto pelo
 * IP da LAN no celular, sem editar arquivo e sem depender do IP do momento.
 *
 *   API_BASE=off                       serve config.js como esta (offline)
 *   API_BASE=https://api.exemplo.com   aponta para um servidor especifico
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 5173;
const API_BASE = (process.env.API_BASE || 'auto').trim();
const PORTA_API = Number(process.env.API_PORT_DEV) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  // Permite instalar o app baixando o APK pelo navegador do proprio celular.
  '.apk': 'application/vnd.android.package-archive',
};

// Mesmo regex ancorado do build-www.mjs: sem a ancora, casaria com a URL de
// exemplo que aparece no comentario de config.js.
const RE_API_BASE = /^(\s*)apiBase:\s*'[^']*'/m;

/** config.js com o apiBase de desenvolvimento injetado. */
async function configDinamico(hostDaRequisicao) {
  const original = await readFile(join(root, 'config.js'), 'utf8');
  if (API_BASE === 'off') return original;

  let base = API_BASE;
  if (API_BASE === 'auto') {
    // "192.168.0.22:5173" -> "192.168.0.22"; tambem cobre IPv6 entre colchetes.
    const host = String(hostDaRequisicao || 'localhost').replace(/:\d+$/, '');
    base = `http://${host}:${PORTA_API}`;
  }
  return original.replace(RE_API_BASE, `$1apiBase: '${base}'`);
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';

    // Impede path traversal: o caminho resolvido tem de continuar dentro de root.
    const filePath = join(root, normalize(urlPath));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end('403 Forbidden');
      return;
    }

    if (urlPath === '/config.js') {
      const corpo = await configDinamico(req.headers.host);
      res.writeHead(200, {
        'Content-Type': MIME['.js'],
        'Content-Length': Buffer.byteLength(corpo),
        'Cache-Control': 'no-store',
      });
      res.end(corpo);
      console.log(`200 ${urlPath} (config dinamico)`);
      return;
    }

    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(404).end('404 Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      // Sem cache: recarregar no celular sempre pega a versao nova.
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
    console.log(`200 ${urlPath}`);
  } catch {
    res.writeHead(404).end('404 Not Found');
    console.log(`404 ${req.url}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`\nServindo ${root}\n`);
  console.log(`  Neste PC:      http://localhost:${port}`);
  const nets = networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  ${name.padEnd(14)} http://${a.address}:${port}`);
      }
    }
  }
  console.log(
    API_BASE === 'off'
      ? '\nModo OFFLINE: config.js servido como esta, sem conta.'
      : API_BASE === 'auto'
        ? `\nAPI: porta ${PORTA_API} do mesmo host da requisicao (API_BASE=off desliga).`
        : `\nAPI: ${API_BASE}`
  );
  console.log('Ctrl+C para parar.\n');
});
