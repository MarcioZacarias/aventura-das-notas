/** Leitura e exigencia de credencial nas rotas. */
import { conferirAccessToken } from './tokens.js';

/**
 * Le o Bearer token e popula req.autenticado = { tipo, id }.
 *   tipo 'conta'       -> id e o conta_id (adulto responsavel logado)
 *   tipo 'dispositivo' -> id e o dispositivo_id (jogo anonimo, sem cadastro)
 */
export async function exigirAuth(req, resposta) {
  const cabecalho = req.headers.authorization || '';
  const [esquema, token] = cabecalho.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return resposta.code(401).send({ erro: 'Credencial ausente.' });
  }
  try {
    const payload = conferirAccessToken(token);
    if (payload.tipo !== 'conta' && payload.tipo !== 'dispositivo') {
      return resposta.code(401).send({ erro: 'Credencial invalida.' });
    }
    req.autenticado = { tipo: payload.tipo, id: payload.sub };
  } catch (e) {
    return resposta.code(401).send({ erro: `Credencial invalida: ${e.message}` });
  }
}

/** Rotas que exigem conta de verdade (nao servem para jogo anonimo). */
export async function exigirConta(req, resposta) {
  await exigirAuth(req, resposta);
  if (resposta.sent) return;
  if (req.autenticado.tipo !== 'conta') {
    return resposta.code(403).send({
      erro: 'Esta acao exige uma conta. Crie uma conta de responsavel para continuar.',
    });
  }
}
