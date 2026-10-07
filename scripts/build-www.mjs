/**
 * Monta a pasta www/ que o Capacitor embute dentro do APK/AAB.
 *
 * Os arquivos do jogo ficam na raiz do repositorio (para o GitHub Pages
 * continuar funcionando). Este script copia apenas o que o app precisa, sem
 * .git, node_modules, android/, server/ etc.
 *
 * Modo online:
 *   API_BASE=https://api.seudominio.com.br npm run sync
 * Isso sobrescreve o apiBase de config.js dentro de www/ (o arquivo da raiz
 * fica intacto) e libera o dominio da API no connect-src da CSP.
 */
import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

// Arquivos obrigatorios do jogo.
const REQUIRED = ['index.html', 'game.js', 'config.js', 'api.js', 'ui-conta.js'];
// Arquivos opcionais (copiados se existirem).
const OPTIONAL = ['manifest.webmanifest', 'favicon.ico'];

const missing = REQUIRED.filter((f) => !existsSync(join(root, f)));
if (missing.length) {
  console.error(`ERRO: arquivo(s) nao encontrado(s) na raiz: ${missing.join(', ')}`);
  process.exit(1);
}

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

const copied = [];
for (const file of [...REQUIRED, ...OPTIONAL]) {
  const src = join(root, file);
  if (!existsSync(src)) continue;
  await copyFile(src, join(www, file));
  copied.push(file);
}

// ---------------------------------------------------------------------------
// Define o apiBase efetivo desta build.
// ---------------------------------------------------------------------------
const configPath = join(www, 'config.js');
let configJs = await readFile(configPath, 'utf8');

// `--api-base URL` na linha de comando tem prioridade sobre API_BASE (forma que
// funciona igual no Windows e no Linux, usada pelo build do Cloudflare).
const iArg = process.argv.indexOf('--api-base');
const apiBaseArg = iArg !== -1 ? process.argv[iArg + 1] || '' : '';
const apiBaseEnv = (apiBaseArg || process.env.API_BASE || '').trim().replace(/\/+$/, '');
let apiBase = apiBaseEnv;

// Ancorado no inicio da linha (flag m): o cabecalho de config.js tem uma URL
// de EXEMPLO escrita como `{ apiBase: '...' }` dentro do comentario, e um regex
// sem ancora casaria com ela primeiro — fazendo o build offline sair apontando
// para o dominio de exemplo.
const RE_API_BASE = /^(\s*)apiBase:\s*'[^']*'/m;

if (apiBaseEnv) {
  if (!RE_API_BASE.test(configJs)) {
    console.error('ERRO: nao encontrei a atribuicao de apiBase em config.js');
    process.exit(1);
  }
  configJs = configJs.replace(RE_API_BASE, `$1apiBase: '${apiBaseEnv}'`);
  await writeFile(configPath, configJs, 'utf8');
} else {
  const achado = configJs.match(/^\s*apiBase:\s*'([^']*)'/m);
  apiBase = (achado?.[1] || '').trim().replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// exigirLogin
// ---------------------------------------------------------------------------
const RE_EXIGIR_LOGIN = /^(\s*)exigirLogin:\s*(true|false)/m;

let exigirLogin;
const envLogin = (process.env.EXIGIR_LOGIN || '').trim();
if (envLogin) {
  exigirLogin = !['0', 'false', 'no', 'nao'].includes(envLogin.toLowerCase());
  if (!RE_EXIGIR_LOGIN.test(configJs)) {
    console.error('ERRO: nao encontrei a atribuicao de exigirLogin em config.js');
    process.exit(1);
  }
  configJs = configJs.replace(RE_EXIGIR_LOGIN, `$1exigirLogin: ${exigirLogin}`);
  await writeFile(configPath, configJs, 'utf8');
} else {
  exigirLogin = /^\s*exigirLogin:\s*true/m.test(configJs);
}

// Login obrigatorio sem servidor geraria um app onde o portao nao existe: sem
// apiBase o modulo de conta se desliga inteiro e o jogo abre liberado. Falhar
// aqui e melhor do que descobrir isso depois de publicar.
if (exigirLogin && !apiBase) {
  console.error('');
  console.error('ERRO: exigirLogin=true exige um servidor configurado.');
  console.error('Sem apiBase, a tela de login nem carrega e o jogo abriria liberado.');
  console.error('');
  console.error('Escolha um dos dois:');
  console.error('  API_BASE=https://api.seudominio.com.br npm run sync   (modo online)');
  console.error('  EXIGIR_LOGIN=0 npm run sync                           (build sem login)');
  console.error('');
  process.exit(1);
}

// Origem (esquema + host + porta) do apiBase, para entrar na CSP.
let apiOrigem = '';
if (apiBase) {
  try {
    apiOrigem = new URL(apiBase).origin;
  } catch {
    console.error(`ERRO: API_BASE nao e uma URL valida: ${apiBase}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------
// O jogo nao carrega nada de origem externa. Esta politica bloqueia qualquer
// tentativa, que e a ameaca real num app hibrido.
//
// - 'unsafe-inline' em style-src: o CSS do jogo esta em <style> no index.html.
// - 'unsafe-inline' em script-src: o Capacitor injeta o bridge nativo inline;
//   sem isso o app pode abrir em tela branca. Nao enfraquece o ponto principal,
//   que e proibir script de origem externa.
// - connect-src: 'self' mais, quando o modo online esta ligado, exatamente a
//   origem da API. Nada alem disso.
const connectSrc = ["'self'", apiOrigem].filter(Boolean).join(' ');

const csp =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  `connect-src ${connectSrc}; ` +
  "media-src 'self' data:; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'";

const indexPath = join(www, 'index.html');
let html = await readFile(indexPath, 'utf8');
if (!html.includes('Content-Security-Policy')) {
  html = html.replace(
    /<meta charset="UTF-8">/i,
    `<meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
  );
  await writeFile(indexPath, html, 'utf8');
}

console.log(`www/ gerada com ${copied.length} arquivo(s): ${copied.join(', ')}`);
console.log(
  apiBase
    ? `Modo ONLINE  -> API em ${apiBase} (liberada no connect-src)`
    : 'Modo OFFLINE -> apiBase vazio, nenhuma requisicao de rede sera feita'
);
console.log(
  exigirLogin
    ? 'Login       -> OBRIGATORIO (primeira execucao precisa de internet)'
    : 'Login       -> opcional'
);
