/**
 * Checagem de propriedade: garante que o chamador so mexe nos jogadores dele.
 *
 * Esta e a barreira central de autorizacao da API. Toda rota que recebe um
 * jogador_id do cliente precisa passar por aqui, senao qualquer um poderia
 * gravar partidas ou ler o historico de outro jogador so trocando o id.
 */
import { q } from '../db.js';

/**
 * @returns {Promise<object|null>} o jogador, ou null se nao existe / nao e do chamador
 */
export async function jogadorDoChamador(autenticado, jogadorId) {
  const coluna = autenticado.tipo === 'conta' ? 'conta_id' : 'dispositivo_id';
  const { rows } = await q(
    `select id, conta_id, dispositivo_id, apelido, avatar
     from jogadores where id = $1 and ${coluna} = $2`,
    [jogadorId, autenticado.id]
  );
  return rows[0] || null;
}

/**
 * Versao que ja responde 404 quando nao encontra. Devolve o jogador, ou
 * undefined caso a resposta ja tenha sido enviada.
 */
export async function exigirJogador(req, resposta, jogadorId) {
  const jogador = await jogadorDoChamador(req.autenticado, jogadorId);
  if (!jogador) {
    // 404 em vez de 403: nao confirma a existencia de ids de outras pessoas.
    resposta.code(404).send({ erro: 'Jogador nao encontrado.' });
    return undefined;
  }
  return jogador;
}
