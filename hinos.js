/**
 * Trechos de hinos: leitura, armadura e posicao na pauta.
 *
 * Os hinos sao cadastrados pelo administrador (admin.html) e ficam no banco;
 * este arquivo so sabe interpretar o que foi cadastrado.
 *
 * FORMATO DO TRECHO (como fica guardado)
 *   Notas escritas separadas por espaco: letra + oitava + acidente opcional.
 *     "E4 F4 G4 B4 C5"   -> sem acidente, vale a armadura do tom
 *     "F4# B4n E4b"      -> acidente escrito, depois da oitava
 *   Acidentes: # sustenido, b bemol, n bequadro. Escrever um acidente e o
 *   mesmo que na partitura: ele aparece na pauta e muda o som.
 *
 * No painel o administrador digita em portugues ("mi4 fa4 sol4 sib4") e
 * deTexto() converte para o formato acima.
 *
 * As notas sao ESCRITAS: o som de cada instrumento sai pela mesma regra do
 * resto do jogo (instrumentos.js aplica a transposicao).
 *
 * Roda no navegador (window.Hinos) e no Node (require).
 */
'use strict';

const Hinos = (() => {
  const LETRAS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const BOTAO = { C: 'do', D: 're', E: 'mi', F: 'fa', G: 'sol', A: 'la', B: 'si' };
  const NOME = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' };
  const SEMITOM = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SIMBOLO = { '#': '♯', b: '♭', n: '♮' };

  const ORDEM_SUSTENIDOS = 'FCGDAEB';
  const ORDEM_BEMOIS = 'BEADGCF';

  // Tons do hinario. armadura > 0 = sustenidos, < 0 = bemois.
  const TONS = [
    { id: 'C', nome: 'Dó maior', armadura: 0 },
    { id: 'G', nome: 'Sol maior', armadura: 1 },
    { id: 'D', nome: 'Ré maior', armadura: 2 },
    { id: 'A', nome: 'Lá maior', armadura: 3 },
    { id: 'E', nome: 'Mi maior', armadura: 4 },
    { id: 'B', nome: 'Si maior', armadura: 5 },
    { id: 'F#', nome: 'Fá♯ maior', armadura: 6 },
    { id: 'F', nome: 'Fá maior', armadura: -1 },
    { id: 'Bb', nome: 'Si♭ maior', armadura: -2 },
    { id: 'Eb', nome: 'Mi♭ maior', armadura: -3 },
    { id: 'Ab', nome: 'Lá♭ maior', armadura: -4 },
    { id: 'Db', nome: 'Ré♭ maior', armadura: -5 },
    { id: 'Gb', nome: 'Sol♭ maior', armadura: -6 },
    { id: 'Am', nome: 'Lá menor', armadura: 0 },
    { id: 'Em', nome: 'Mi menor', armadura: 1 },
    { id: 'Bm', nome: 'Si menor', armadura: 2 },
    { id: 'F#m', nome: 'Fá♯ menor', armadura: 3 },
    { id: 'C#m', nome: 'Dó♯ menor', armadura: 4 },
    { id: 'Dm', nome: 'Ré menor', armadura: -1 },
    { id: 'Gm', nome: 'Sol menor', armadura: -2 },
    { id: 'Cm', nome: 'Dó menor', armadura: -3 },
    { id: 'Fm', nome: 'Fá menor', armadura: -4 },
  ];
  const TOM_POR_ID = Object.fromEntries(TONS.map((t) => [t.id, t]));

  const COMPASSOS = ['2/2', '2/4', '3/2', '3/4', '3/8', '4/4', '6/8', '9/8', '12/8'];

  /** Binario, ternario ou quaternario, pelo numero de tempos do compasso. */
  function tipoCompasso(compasso) {
    const n = Number(String(compasso).split('/')[0]);
    const simples = { 2: 'Binário', 3: 'Ternário', 4: 'Quaternário' }[n];
    if (simples) return simples;
    // Compostos: 6/8 = 2 tempos, 9/8 = 3, 12/8 = 4.
    const composto = { 6: 'Binário composto', 9: 'Ternário composto', 12: 'Quaternário composto' }[n];
    return composto || '';
  }

  // ----------------------------------------------------------- pauta
  // Nota na linha de cima de cada clave (step 0); cada step desce meia linha.
  // Precisa casar com CLEFS em game.js: Do4 na clave de Sol = step 10.
  const diatonico = (letra, oitava) => oitava * 7 + LETRAS.indexOf(letra);
  const TOPO = { sol: diatonico('F', 5), fa: diatonico('A', 3), do: diatonico('G', 4) };

  // Ate duas linhas suplementares acima e abaixo.
  const STEP_MIN = -4;
  const STEP_MAX = 14;

  // Desenho da armadura: posicoes na clave de Sol; as outras deslocam.
  const POS_SUSTENIDOS_SOL = [0, 3, -1, 2, 5, 1, 4];
  const POS_BEMOIS_SOL = [4, 1, 5, 2, 6, 3, 7];
  const DESLOCAMENTO_CLAVE = { sol: 0, fa: 2, do: 1 };

  const RE_TOKEN = /^([A-G])([1-7])([#bn])?$/;

  function lerToken(token) {
    const m = RE_TOKEN.exec(token);
    if (!m) throw new Error(`nota invalida: ${token}`);
    return { letra: m[1], oitava: Number(m[2]), acidente: m[3] || null };
  }

  /** Alteracao (+1, -1 ou 0) que a armadura aplica numa letra. */
  function alteracaoDaArmadura(letra, armadura) {
    if (armadura > 0 && ORDEM_SUSTENIDOS.slice(0, armadura).includes(letra)) return 1;
    if (armadura < 0 && ORDEM_BEMOIS.slice(0, -armadura).includes(letra)) return -1;
    return 0;
  }

  /**
   * Notas de um trecho prontas para o jogo.
   * @returns {Array<{id, button, label, step, midi, acidente}>}
   */
  function notasDoTrecho(trecho, clave, armadura) {
    return String(trecho || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const { letra, oitava, acidente } = lerToken(token);
        const alteracao =
          acidente === '#' ? 1 : acidente === 'b' ? -1 : acidente === 'n' ? 0 : alteracaoDaArmadura(letra, armadura);
        return {
          id: letra + oitava,
          button: BOTAO[letra],
          label: NOME[letra] + (alteracao === 1 ? '♯' : alteracao === -1 ? '♭' : ''),
          step: TOPO[clave] - diatonico(letra, oitava),
          midi: 12 * (oitava + 1) + SEMITOM[letra] + alteracao,
          acidente,
        };
      });
  }

  /** Simbolos da armadura para desenhar: [{ step, simbolo }]. */
  function armaduraNaPauta(clave, armadura) {
    const desloc = DESLOCAMENTO_CLAVE[clave] || 0;
    const n = Math.abs(armadura);
    const pos = armadura > 0 ? POS_SUSTENIDOS_SOL : POS_BEMOIS_SOL;
    const simbolo = armadura > 0 ? '♯' : '♭';
    return pos.slice(0, n).map((p) => ({ step: p + desloc, simbolo }));
  }

  // ------------------------------------------------- texto em portugues
  const NOMES_PT = { do: 'C', dó: 'C', re: 'D', ré: 'D', mi: 'E', fa: 'F', fá: 'F', sol: 'G', la: 'A', lá: 'A', si: 'B' };
  const ACIDENTE_PT = { '#': '#', '♯': '#', b: 'b', '♭': 'b', n: 'n', '♮': 'n' };
  const RE_PT = /^(do|dó|re|ré|mi|fa|fá|sol|la|lá|si)([#♯b♭n♮])?([1-7])([#♯b♭n♮])?$/;

  /**
   * "mi4 fa4 sol4 sib4" -> { tokens: ['E4','F4','G4','B4b'], erros: [] }
   * Aceita o acidente antes ou depois da oitava ("sib4" ou "si4b").
   * Com `clave`, confere se cada nota cabe na pauta do jogo.
   */
  function deTexto(texto, clave) {
    const tokens = [];
    const erros = [];
    const partes = String(texto || '')
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter(Boolean);
    for (const parte of partes) {
      const m = RE_PT.exec(parte);
      if (!m) {
        erros.push(`"${parte}" não é uma nota (use, por exemplo, mi4, sib3, fa#4).`);
        continue;
      }
      const letra = NOMES_PT[m[1]];
      const oitava = Number(m[3]);
      const acidente = ACIDENTE_PT[m[2] || m[4] || ''] || '';
      if (clave) {
        const step = TOPO[clave] - diatonico(letra, oitava);
        if (step < STEP_MIN || step > STEP_MAX) {
          erros.push(`"${parte}" fica fora da pauta nesta clave (mais de duas linhas suplementares).`);
          continue;
        }
      }
      tokens.push(letra + oitava + acidente);
    }
    return { tokens, erros };
  }

  /** ['E4','B4b'] -> "mi4 si♭4" (para mostrar e editar no painel). */
  function paraTexto(trecho) {
    return String(trecho || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const { letra, oitava, acidente } = lerToken(t);
        const nome = { C: 'dó', D: 'ré', E: 'mi', F: 'fá', G: 'sol', A: 'lá', B: 'si' }[letra];
        return nome + (acidente ? SIMBOLO[acidente] : '') + oitava;
      })
      .join(' ');
  }

  return {
    TONS,
    COMPASSOS,
    STEP_MIN,
    STEP_MAX,
    tom: (id) => TOM_POR_ID[id] || null,
    tipoCompasso,
    notasDoTrecho,
    armaduraNaPauta,
    deTexto,
    paraTexto,
    SIMBOLO,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Hinos;
if (typeof window !== 'undefined') window.Hinos = Hinos;
