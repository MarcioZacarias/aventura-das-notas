/**
 * Validacao de partida no servidor.
 *
 * Pontuacao enviada pelo cliente e sempre falsificavel: basta um proxy para
 * mandar {pontuacao: 999999}. Como o ranking e comparativo, isso precisa de
 * checagem no servidor.
 *
 * A abordagem: reproduzir aqui o cronograma de spawn do jogo (game.js) e
 * calcular quantas notas NO MAXIMO poderiam ter aparecido na duracao informada,
 * assumindo jogo perfeito e resposta instantanea. Como no jogo a nota pode ser
 * respondida desde o instante em que nasce, esse numero e um teto real.
 *
 * Constantes espelhadas de game.js — se o balanceamento mudar la, mude aqui:
 *   spawnInterval inicial   2400 ms
 *   lastSpawnTime inicial   1500 ms  (startGame)
 *   nivel                   1 + floor(pontuacao / 8)
 *   spawnInterval(nivel)    max(900, 2400 - (nivel-1) * 150)
 *   vidas                   3
 */

const SPAWN_INICIAL_MS = 2400;
const ACUMULADO_INICIAL_MS = 1500;
const SPAWN_MINIMO_MS = 900;
const DECAIMENTO_POR_NIVEL_MS = 150;
const PONTOS_POR_NIVEL = 8;
export const VIDAS = 3;

// Folga para desvio de relogio do aparelho e granularidade de frame.
const TOLERANCIA_RELATIVA = 0.10;
const TOLERANCIA_ABSOLUTA = 2;

const DURACAO_MIN_MS = 500;
const DURACAO_MAX_MS = 2 * 60 * 60 * 1000; // 2 h

const intervaloDoNivel = (nivel) =>
  Math.max(SPAWN_MINIMO_MS, SPAWN_INICIAL_MS - (nivel - 1) * DECAIMENTO_POR_NIVEL_MS);

export const nivelDaPontuacao = (pontuacao) =>
  1 + Math.floor(pontuacao / PONTOS_POR_NIVEL);

/**
 * Maximo de notas que poderiam ter nascido em `duracaoMs`, assumindo que o
 * jogador acertou todas instantaneamente (o que acelera o proximo nivel e,
 * portanto, o proprio spawn — por isso a simulacao e iterativa).
 */
export function maxNotasPossiveis(duracaoMs) {
  let t = 0;
  let acumulado = ACUMULADO_INICIAL_MS;
  let notas = 0;

  // O teto e ~duracao/900ms; o limite abaixo apenas evita loop infinito.
  const tetoIteracoes = Math.ceil(duracaoMs / SPAWN_MINIMO_MS) + 10;

  for (let i = 0; i < tetoIteracoes; i++) {
    const intervalo = intervaloDoNivel(nivelDaPontuacao(notas));
    const espera = Math.max(0, intervalo - acumulado);
    t += espera;
    if (t > duracaoMs) break;
    notas++;
    acumulado = 0;
  }
  return notas;
}

/**
 * @returns {{ok: true} | {ok: false, motivo: string}}
 */
export function validarPartida(p) {
  const { pontuacao, acertos, erros, nivel_max, duracao_ms } = p;

  if (duracao_ms < DURACAO_MIN_MS) return { ok: false, motivo: 'Duracao curta demais.' };
  if (duracao_ms > DURACAO_MAX_MS) return { ok: false, motivo: 'Duracao longa demais.' };

  // No jogo, cada acerto vale exatamente 1 ponto.
  if (acertos !== pontuacao) {
    return { ok: false, motivo: 'Pontuacao nao corresponde ao numero de acertos.' };
  }

  // Sao 3 vidas: a partida termina no terceiro erro.
  if (erros > VIDAS) return { ok: false, motivo: `Mais de ${VIDAS} erros e impossivel.` };

  // O nivel e derivado da pontuacao; +1 de folga para a virada de nivel.
  const nivelEsperado = nivelDaPontuacao(pontuacao);
  if (nivel_max > nivelEsperado + 1) {
    return { ok: false, motivo: 'Nivel incompativel com a pontuacao.' };
  }

  const teto = maxNotasPossiveis(duracao_ms);
  const tetoComFolga = Math.ceil(teto * (1 + TOLERANCIA_RELATIVA)) + TOLERANCIA_ABSOLUTA;

  // Acertos + erros = notas que passaram pela tela.
  if (acertos + erros > tetoComFolga) {
    return {
      ok: false,
      motivo: `Impossivel: ${acertos + erros} notas em ${(duracao_ms / 1000).toFixed(1)}s (maximo ${tetoComFolga}).`,
    };
  }

  return { ok: true };
}
