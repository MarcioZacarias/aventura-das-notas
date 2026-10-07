/**
 * Tokens de acesso (JWT HS256) e de refresh (opaco, aleatorio).
 *
 * JWT implementado sobre node:crypto em vez de biblioteca externa: o escopo
 * aqui e um unico algoritmo simetrico, e assim nao entra dependencia na
 * superficie de seguranca. O ponto critico — recusar alg diferente de HS256,
 * inclusive "none" — esta explicito em conferirAccessToken().
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const deB64url = (s) => Buffer.from(s, 'base64url');

function assinar(dados) {
  return createHmac('sha256', config.jwtSecret).update(dados).digest();
}

export function gerarAccessToken(payload, ttlSeg = config.accessTokenTtlSeg) {
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { ...payload, iat: agora, exp: agora + ttlSeg };
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const dados = `${cabecalho}.${b64url(JSON.stringify(corpo))}`;
  return `${dados}.${b64url(assinar(dados))}`;
}

/** Retorna o payload, ou lanca Error com motivo. */
export function conferirAccessToken(token) {
  if (typeof token !== 'string') throw new Error('token ausente');
  const partes = token.split('.');
  if (partes.length !== 3) throw new Error('formato invalido');

  const [cabecalhoB64, corpoB64, assinaturaB64] = partes;

  let cabecalho;
  try {
    cabecalho = JSON.parse(deB64url(cabecalhoB64).toString('utf8'));
  } catch {
    throw new Error('cabecalho invalido');
  }
  // Barreira contra troca de algoritmo (alg=none / alg=RS256 com chave publica).
  if (cabecalho.alg !== 'HS256') throw new Error('algoritmo nao aceito');

  const esperada = assinar(`${cabecalhoB64}.${corpoB64}`);
  const recebida = deB64url(assinaturaB64);
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    throw new Error('assinatura invalida');
  }

  let corpo;
  try {
    corpo = JSON.parse(deB64url(corpoB64).toString('utf8'));
  } catch {
    throw new Error('payload invalido');
  }

  const agora = Math.floor(Date.now() / 1000);
  if (typeof corpo.exp !== 'number' || corpo.exp <= agora) throw new Error('token expirado');

  return corpo;
}

/**
 * Refresh token: valor aleatorio opaco. O banco guarda somente o SHA-256,
 * de modo que um dump do banco nao permite se passar por ninguem.
 */
export function gerarRefreshToken() {
  const valor = randomBytes(32).toString('base64url');
  return { valor, hash: hashRefreshToken(valor) };
}

export function hashRefreshToken(valor) {
  return createHash('sha256').update(valor).digest('hex');
}
