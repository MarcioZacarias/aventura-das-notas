/**
 * Hash de senha com scrypt (embutido no Node — sem dependencia nativa para
 * compilar, ao contrario de bcrypt/argon2).
 *
 * Formato armazenado: scrypt$N$r$p$saltBase64$hashBase64
 * Guardar os parametros junto permite endurecer o custo no futuro sem
 * invalidar as senhas ja existentes.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);

const N = 32768; // custo de CPU/memoria (2^15)
const R = 8;
const P = 1;
const TAM_CHAVE = 64;
// scrypt precisa de ~128*N*r bytes; com N=32768 e r=8 da 32 MB, exatamente o
// limite default do Node, que entao estoura. Damos folga.
const MAXMEM = 96 * 1024 * 1024;

export async function gerarHash(senha) {
  const salt = randomBytes(16);
  const chave = await scrypt(senha.normalize('NFKC'), salt, TAM_CHAVE, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${chave.toString('base64')}`;
}

export async function conferirSenha(senha, armazenado) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(armazenado).split('$');
    if (alg !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const esperado = Buffer.from(hashB64, 'base64');
    const calculado = await scrypt(senha.normalize('NFKC'), salt, esperado.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });

    // Comparacao em tempo constante: evita vazar informacao por timing.
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

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
