/**
 * Moderacao de apelido.
 *
 * Necessario porque o apelido aparece no ranking geral, visivel a estranhos.
 * Num app cujo publico-alvo inclui criancas, conteudo gerado por usuario
 * exposto publicamente precisa de filtro e de canal de denuncia (Politica de
 * Familias do Google Play; App Review Guidelines da Apple).
 *
 * IMPORTANTE, sem ilusao: lista de bloqueio NAO e moderacao completa. Ela pega
 * o obvio e o preguicoso. O que fecha o ciclo e a denuncia (POST /v1/denuncias)
 * com alguem olhando. Trate isto como a primeira barreira, nao como a solucao.
 */

// Normaliza para furar as evasoes mais comuns: acento, leet, repeticao,
// separador. "P4l@vr4o", "p-a-l-a-v-r-a-o" e "paaalavraao" caem no mesmo texto.
const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '*': '',
};

// Diacriticos combinantes (deixados pelo normalize('NFD')).
const RE_ACENTOS = /[̀-ͯ]/g;

// Caracteres invisiveis e de controle bidirecional, usados para disfarcar
// texto: zero-width space, marcas LTR/RTL, word joiner, BOM.
const RE_INVISIVEIS = /[​-‏‪-‮⁠-⁤﻿]/;

export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(RE_ACENTOS, '')
    .replace(/[0-9@$!|*]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')        // descarta o que nao for letra
    .replace(/(.)\1{1,}/g, '$1');  // colapsa repeticoes: aaa -> a
}

/**
 * Termos que so bloqueiam quando formam a palavra inteira (normalizada).
 * Sao curtos e aparecem dentro de palavras inocentes — "cu" esta em "curioso",
 * "ano" em "piano". Casar por substring aqui geraria falso positivo.
 */
const EXATOS = new Set([
  'cu', 'bct', 'fdp', 'pqp', 'wtf',
  'ass', 'sex', 'sexo', 'nazi', 'hitler',
]);

/**
 * Termos longos e distintivos, seguros para casar por substring: quem escreve
 * isso dentro de outra palavra esta escapando do filtro de proposito.
 */
const SUBSTRING = [
  'buceta', 'boceta', 'caralho', 'carai', 'porra', 'foder', 'fuder',
  'puta', 'putaria', 'piroca', 'penis', 'vagina', 'xoxota',
  'merda', 'bosta', 'cacete', 'arrombado', 'corno', 'viado', 'veado',
  'bicha', 'traveco', 'punheta', 'siririca', 'chupa', 'transar',
  'estupro', 'estuprar', 'pedofil', 'porno', 'xvideos',
  'crioulo', 'macaco',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'whore', 'rape',
  'nigger', 'faggot', 'retard',
  'cocaina', 'maconha', 'suicid',
];

/** Nomes que se passariam por autoridade do app. */
const RESERVADOS = [
  'admin', 'administrador', 'moderador', 'suporte',
  'oficial', 'staff', 'aventuradasnotas',
];

/**
 * Valida um apelido que ficara publicamente visivel no ranking.
 * @returns {null | string} null se ok, ou a mensagem do problema.
 */
export function validarApelido(bruto) {
  const texto = String(bruto || '').trim();

  if (texto.length < 2) return 'O apelido precisa de pelo menos 2 caracteres.';
  if (texto.length > 20) return 'O apelido pode ter no maximo 20 caracteres.';

  // Só letras (com acento), numeros, espaco, hifen e apostrofo. Isso ja barra
  // emoji, marcacao HTML e a maioria dos caracteres de disfarce.
  if (!/^[\p{L}\p{N} '-]+$/u.test(texto)) {
    return 'Use apenas letras, numeros, espaco e hifen no apelido.';
  }

  if (RE_INVISIVEIS.test(texto)) return 'Apelido invalido.';

  const norm = normalizar(texto);
  if (norm.length < 2) return 'O apelido precisa ter pelo menos 2 letras.';

  for (const termo of SUBSTRING) {
    if (norm.includes(normalizar(termo))) return 'Escolha outro apelido, por favor.';
  }

  // A palavra inteira e cada pedaco separado por espaco, hifen ou apostrofo.
  const pedacos = [norm, ...texto.split(/[\s'-]+/).map(normalizar)].filter(Boolean);
  for (const p of pedacos) {
    if (EXATOS.has(p)) return 'Escolha outro apelido, por favor.';
    if (RESERVADOS.includes(p)) return 'Esse apelido e reservado. Escolha outro.';
  }

  return null;
}
