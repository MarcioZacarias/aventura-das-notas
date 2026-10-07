/**
 * Primitivas de criptografia sobre WebCrypto (o que o Workers oferece nativo).
 *
 * Substitui o node:crypto do servidor original: tokens JWT HS256, refresh
 * tokens opacos e hash de senha.
 *
 * SENHA: o servidor original usava scrypt. No Workers o caminho nativo e
 * PBKDF2-SHA256, limitado a 100000 iteracoes. Formato armazenado:
 *   pbkdf2-sha256$iteracoes$saltBase64$hashBase64
 * Os parametros ficam junto do hash para o custo poder mudar no futuro sem
 * invalidar as senhas existentes.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------- base64
export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deB64url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const deB64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

// --------------------------------------------------------------- aleatorios
export function bytesAleatorios(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Valor aleatorio opaco em base64url (refresh token, segredo de aparelho). */
export const tokenAleatorio = (n = 32) => b64url(bytesAleatorios(n));

export async function sha256Hex(texto) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparacao em tempo constante: evita vazar informacao por timing. */
function iguais(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

// ---------------------------------------------------------------------- JWT
const chavesHmac = new Map();

function chaveHmac(segredo) {
  let chave = chavesHmac.get(segredo);
  if (!chave) {
    chave = crypto.subtle.importKey(
      'raw',
      enc.encode(segredo),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    chavesHmac.set(segredo, chave);
  }
  return chave;
}

export async function gerarAccessToken(cfg, payload) {
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { ...payload, iat: agora, exp: agora + cfg.accessTokenTtlSeg };
  const cabecalho = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const dados = `${cabecalho}.${b64url(enc.encode(JSON.stringify(corpo)))}`;
  const assinatura = await crypto.subtle.sign('HMAC', await chaveHmac(cfg.jwtSecret), enc.encode(dados));
  return `${dados}.${b64url(new Uint8Array(assinatura))}`;
}

/** Retorna o payload, ou lanca Error com o motivo. */
export async function conferirAccessToken(cfg, token) {
  if (typeof token !== 'string') throw new Error('token ausente');
  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('formato invalido');

  const [cabecalhoB64, corpoB64, assinaturaB64] = partes;

  let cabecalho;
  try {
    cabecalho = JSON.parse(dec.decode(deB64url(cabecalhoB64)));
  } catch {
    throw new Error('cabecalho invalido');
  }
  // Barreira contra troca de algoritmo (alg=none / alg=RS256 com chave publica).
  if (cabecalho?.alg !== 'HS256') throw new Error('algoritmo nao aceito');

  let assinatura;
  try {
    assinatura = deB64url(assinaturaB64);
  } catch {
    throw new Error('assinatura invalida');
  }
  // verify() do WebCrypto ja compara em tempo constante.
  const valida = await crypto.subtle.verify(
    'HMAC',
    await chaveHmac(cfg.jwtSecret),
    assinatura,
    enc.encode(`${cabecalhoB64}.${corpoB64}`)
  );
  if (!valida) throw new Error('assinatura invalida');

  let corpo;
  try {
    corpo = JSON.parse(dec.decode(deB64url(corpoB64)));
  } catch {
    throw new Error('payload invalido');
  }

  const agora = Math.floor(Date.now() / 1000);
  if (typeof corpo.exp !== 'number' || corpo.exp <= agora) throw new Error('token expirado');

  return corpo;
}

// -------------------------------------------------------------------- senha
const ALG_SENHA = 'pbkdf2-sha256';
const TAM_HASH = 32;

async function derivar(senha, salt, iteracoes, tamanho) {
  const chave = await crypto.subtle.importKey(
    'raw',
    enc.encode(senha.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes },
    chave,
    tamanho * 8
  );
  return new Uint8Array(bits);
}

export async function gerarHashSenha(cfg, senha) {
  const salt = bytesAleatorios(16);
  const hash = await derivar(senha, salt, cfg.pbkdf2Iteracoes, TAM_HASH);
  return `${ALG_SENHA}$${cfg.pbkdf2Iteracoes}$${b64(salt)}$${b64(hash)}`;
}

export async function conferirSenha(senha, armazenado) {
  try {
    const [alg, iteracoes, saltB64, hashB64] = String(armazenado).split('$');
    if (alg !== ALG_SENHA) return false;
    const esperado = deB64(hashB64);
    const calculado = await derivar(String(senha), deB64(saltB64), Number(iteracoes), esperado.length);
    return iguais(calculado, esperado);
  } catch {
    return false;
  }
}

/**
 * Hash descartavel no formato valido, usado para gastar o mesmo tempo de CPU
 * quando o e-mail nao existe. Sem isso, login com e-mail inexistente responde
 * mais rapido que com senha errada, e isso revela quem tem conta no servico.
 */
export const hashIsca = (cfg) =>
  `${ALG_SENHA}$${cfg.pbkdf2Iteracoes}$AAAAAAAAAAAAAAAAAAAAAA==$${'A'.repeat(43)}=`;

/** Regras minimas de senha. Retorna null se ok, ou a mensagem do problema. */
export function validarForcaSenha(senha) {
  if (typeof senha !== 'string') return 'Senha invalida.';
  if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (senha.length > 200) return 'Senha longa demais.';
  if (/^\d+$/.test(senha)) return 'A senha nao pode ser somente numeros.';
  const comuns = ['12345678', 'senha123', 'password', 'aventura', '11111111'];
  if (comuns.includes(senha.toLowerCase())) return 'Essa senha e muito comum.';
  return null;
}
