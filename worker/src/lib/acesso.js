/**
 * Autenticacao, propriedade de jogador e limite de requisicoes.
 */
import { falha } from '../http.js';
import { primeiro } from '../db.js';
import { conferirAccessToken } from './cripto.js';

/**
 * Le o Bearer token e devolve { tipo, id }.
 *   tipo 'conta'       -> id e o conta_id (adulto responsavel logado)
 *   tipo 'dispositivo' -> id e o dispositivo_id (jogo anonimo, sem cadastro)
 *
 * Com `exigeConta`, recusa credencial de aparelho anonimo (403).
 */
export async function autenticar(req, cfg, exigeConta = false) {
  const cabecalho = req.headers.get('authorization') || '';
  const [esquema, token] = cabecalho.split(' ');

  if (esquema !== 'Bearer' || !token) throw falha(401, 'Credencial ausente.');

  let payload;
  try {
    payload = await conferirAccessToken(cfg, token);
  } catch (e) {
    throw falha(401, `Credencial invalida: ${e.message}`);
  }
  if (payload.tipo !== 'conta' && payload.tipo !== 'dispositivo') {
    throw falha(401, 'Credencial invalida.');
  }
  if (exigeConta && payload.tipo !== 'conta') {
    throw falha(403, 'Esta acao exige uma conta. Crie uma conta de responsavel para continuar.');
  }
  return { tipo: payload.tipo, id: payload.sub };
}

/** Coluna de dono do jogador para o tipo de credencial. */
export const colunaDono = (autenticado) =>
  autenticado.tipo === 'conta' ? 'conta_id' : 'dispositivo_id';

/**
 * Checagem de propriedade: a barreira central de autorizacao da API. Toda rota
 * que recebe um jogador_id do cliente passa por aqui, senao qualquer um poderia
 * mexer no jogador de outra pessoa so trocando o id.
 *
 * @returns {Promise<object|null>} o jogador, ou null se nao existe / nao e do chamador
 */
export function jogadorDoChamador(db, autenticado, jogadorId) {
  return primeiro(
    db,
    `select id, conta_id, dispositivo_id, apelido, avatar
     from jogadores where id = ? and ${colunaDono(autenticado)} = ?`,
    jogadorId,
    autenticado.id
  );
}

/** Igual, mas responde 404 (nao confirma a existencia de ids alheios). */
export async function exigirJogador(c, jogadorId) {
  const jogador = await jogadorDoChamador(c.db, c.auth, jogadorId);
  if (!jogador) throw falha(404, 'Jogador nao encontrado.');
  return jogador;
}

/**
 * Limite de requisicoes por IP, usando os bindings de Rate Limiting do Workers
 * (declarados em wrangler.jsonc). O contador e por localidade da Cloudflare e
 * eventualmente consistente: serve para frear abuso, nao como cota exata.
 */
export async function checarLimite(c, binding) {
  if (c.cfg.limitesDesligados) return;
  const limitador = c.env[binding];
  if (!limitador) return;

  let resultado;
  try {
    resultado = await limitador.limit({ key: c.ip });
  } catch (e) {
    // Falha do limitador nao derruba a API.
    console.error('rate limit indisponivel', binding, e?.message);
    return;
  }
  if (!resultado.success) {
    throw falha(429, 'Muitas requisicoes. Aguarde um pouco e tente de novo.');
  }
}
