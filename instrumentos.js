/**
 * Instrumentos da orquestra da CCB e o som de cada um.
 *
 * Cada jogador escolhe o seu instrumento. A escolha define:
 *   - quais claves ficam liberadas (so as que o instrumento le de verdade;
 *     assim toda nota do jogo cabe na extensao real dele)
 *   - o timbre e a altura do som de cada nota
 *
 * TRANSPOSITORES: o jogo toca o SOM REAL do instrumento. O aluno de sax alto
 * que le um Do escrito ouve o Mi bemol que o sax dele produziria, porque o
 * hinario dele e escrito transposto. `transposicao` e a distancia, em
 * semitons, entre a nota escrita e a nota que soa.
 *
 * GRAVACOES: FluidR3_GM (Frank Wen), licenca Creative Commons Attribution 3.0,
 * via github.com/gleitz/midi-js-soundfonts. Ficam em sons/<amostra>/<nota>.mp3,
 * baixadas por scripts/baixar-sons.mjs. Instrumentos sem gravacao propria no
 * banco usam a de um parente proximo (campo `amostra`).
 *
 * Este arquivo roda no navegador (window.Instrumentos) e no Node (require),
 * por isso nao toca em window/document no carregamento.
 */
'use strict';

const Instrumentos = (() => {
  // ---------------------------------------------------------------- catalogo
  const NAIPES = [
    { id: 'cordas', nome: 'Cordas', icone: '🎻' },
    { id: 'madeiras', nome: 'Madeiras', icone: '🎵' },
    { id: 'saxofones', nome: 'Saxofones', icone: '🎷' },
    { id: 'metais', nome: 'Metais', icone: '🎺' },
    { id: 'teclas', nome: 'Teclas e fole', icone: '🎹' },
  ];

  // claves: as que o instrumento le. transposicao: semitons (som - escrita).
  const LISTA = [
    { id: 'violino', nome: 'Violino', naipe: 'cordas', claves: ['sol'], transposicao: 0, amostra: 'violin' },
    { id: 'viola', nome: 'Viola', naipe: 'cordas', claves: ['do'], transposicao: 0, amostra: 'viola' },
    { id: 'violoncelo', nome: 'Violoncelo', naipe: 'cordas', claves: ['fa'], transposicao: 0, amostra: 'cello' },
    // Soa uma oitava abaixo do escrito.
    { id: 'contrabaixo', nome: 'Contrabaixo acústico', naipe: 'cordas', claves: ['fa'], transposicao: -12, amostra: 'contrabass' },

    { id: 'flauta', nome: 'Flauta transversal', naipe: 'madeiras', claves: ['sol'], transposicao: 0, amostra: 'flute' },
    { id: 'oboe', nome: 'Oboé', naipe: 'madeiras', claves: ['sol'], transposicao: 0, amostra: 'oboe' },
    { id: 'oboe_damore', nome: "Oboé d'amore", naipe: 'madeiras', claves: ['sol'], transposicao: -3, amostra: 'oboe' },
    { id: 'corne_ingles', nome: 'Corne inglês', naipe: 'madeiras', claves: ['sol'], transposicao: -7, amostra: 'english_horn' },
    { id: 'fagote', nome: 'Fagote', naipe: 'madeiras', claves: ['fa'], transposicao: 0, amostra: 'bassoon' },
    { id: 'clarinete', nome: 'Clarinete (Si♭)', naipe: 'madeiras', claves: ['sol'], transposicao: -2, amostra: 'clarinet' },
    { id: 'clarinete_alto', nome: 'Clarinete alto (Mi♭)', naipe: 'madeiras', claves: ['sol'], transposicao: -9, amostra: 'clarinet' },
    { id: 'clarone', nome: 'Clarone (clarinete baixo)', naipe: 'madeiras', claves: ['sol'], transposicao: -14, amostra: 'clarinet' },

    { id: 'sax_soprano', nome: 'Sax soprano (reto ou curvo)', naipe: 'saxofones', claves: ['sol'], transposicao: -2, amostra: 'soprano_sax' },
    { id: 'sax_alto', nome: 'Sax alto', naipe: 'saxofones', claves: ['sol'], transposicao: -9, amostra: 'alto_sax' },
    { id: 'sax_tenor', nome: 'Sax tenor', naipe: 'saxofones', claves: ['sol'], transposicao: -14, amostra: 'tenor_sax' },
    { id: 'sax_baritono', nome: 'Sax barítono', naipe: 'saxofones', claves: ['sol'], transposicao: -21, amostra: 'baritone_sax' },

    { id: 'trompete', nome: 'Trompete', naipe: 'metais', claves: ['sol'], transposicao: -2, amostra: 'trumpet' },
    { id: 'cornet', nome: 'Cornet', naipe: 'metais', claves: ['sol'], transposicao: -2, amostra: 'trumpet' },
    { id: 'flugelhorn', nome: 'Flugelhorn', naipe: 'metais', claves: ['sol'], transposicao: -2, amostra: 'trumpet' },
    { id: 'trompa', nome: 'Trompa', naipe: 'metais', claves: ['sol'], transposicao: -7, amostra: 'french_horn' },
    // Trombone de pisto em Si bemol, lido em clave de Sol.
    { id: 'trombonito', nome: 'Trombonito', naipe: 'metais', claves: ['sol'], transposicao: -14, amostra: 'trombone' },
    { id: 'trombone', nome: 'Trombone', naipe: 'metais', claves: ['fa'], transposicao: 0, amostra: 'trombone' },
    { id: 'eufonio', nome: 'Eufônio (bombardino)', naipe: 'metais', claves: ['fa'], transposicao: 0, amostra: 'trombone' },
    { id: 'tuba', nome: 'Tuba', naipe: 'metais', claves: ['fa'], transposicao: 0, amostra: 'tuba' },

    { id: 'orgao', nome: 'Órgão', naipe: 'teclas', claves: ['sol', 'fa'], transposicao: 0, amostra: 'church_organ' },
    { id: 'acordeon', nome: 'Acordeon', naipe: 'teclas', claves: ['sol', 'fa'], transposicao: 0, amostra: 'accordion' },
  ];

  const POR_ID = Object.fromEntries(LISTA.map((i) => [i.id, i]));

  // Notas escritas de cada clave no jogo. Precisa casar com CLEFS em game.js.
  const NOTAS_DA_CLAVE = {
    sol: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'],
    fa: ['E2', 'F2', 'G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'],
    do: ['D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4'],
  };

  // ------------------------------------------------------------------ notas
  const SEMITOM = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // Nomes no padrao do banco de sons (bemois).
  const NOMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  /** 'C4' -> 60 (MIDI). So notas naturais, que e o que o jogo usa. */
  function midiDe(nota) {
    const m = /^([A-G])(-?\d)$/.exec(nota);
    if (!m) throw new Error(`nota invalida: ${nota}`);
    return 12 * (Number(m[2]) + 1) + SEMITOM[m[1]];
  }

  const nomeDe = (midi) => NOMES[midi % 12] + (Math.floor(midi / 12) - 1);

  /** Nota que SOA quando `instrumento` toca a nota escrita `nota`. */
  function notaSoando(instrumentoId, nota) {
    const inst = POR_ID[instrumentoId];
    return nomeDe(midiDe(nota) + (inst ? inst.transposicao : 0));
  }

  /** Frequencia em Hz da nota que soa (para o som sintetizado de reserva). */
  function frequenciaSoando(instrumentoId, nota) {
    const inst = POR_ID[instrumentoId];
    const midi = midiDe(nota) + (inst ? inst.transposicao : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Todos os arquivos que um instrumento precisa: [{ amostra, nota }]. */
  // Extensao da pauta usada pelos hinos: ate duas linhas suplementares acima e
  // abaixo (mesmos limites de hinos.js). Notas naturais, da mais aguda a mais grave.
  const LETRAS_NAT = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const TOPO_CLAVE = { sol: ['F', 5], fa: ['A', 3], do: ['G', 4] };
  const EXTENSAO_DA_CLAVE = Object.fromEntries(
    Object.entries(TOPO_CLAVE).map(([clave, [letra, oit]]) => {
      const topo = oit * 7 + LETRAS_NAT.indexOf(letra);
      const notas = [];
      for (let step = -4; step <= 14; step++) {
        const d = topo - step;
        notas.push(LETRAS_NAT[d % 7] + Math.floor(d / 7));
      }
      return [clave, notas];
    })
  );

  /**
   * Todos os arquivos que um instrumento pode precisar: [{ amostra, nota }].
   * Cobre a pauta inteira dos hinos (com linhas suplementares); o jogo normal
   * usa so as de NOTAS_DA_CLAVE.
   */
  function arquivosDo(instrumentoId) {
    const inst = POR_ID[instrumentoId];
    if (!inst) return [];
    const vistos = new Set();
    return inst.claves
      .flatMap((clave) => EXTENSAO_DA_CLAVE[clave])
      .map((nota) => notaSoando(inst.id, nota))
      .filter((nota) => !vistos.has(nota) && vistos.add(nota))
      .map((nota) => ({ amostra: inst.amostra, nota }));
  }

  // --------------------------------------------------------------- escolha
  const CHAVE_LOCAL = 'adn.instrumento';

  function lerLocal() {
    try {
      return localStorage.getItem(CHAVE_LOCAL);
    } catch {
      return null;
    }
  }

  /**
   * Instrumento de quem esta jogando. Havendo perfil, vale so o do perfil:
   * cada crianca tem o seu, e um perfil novo no mesmo aparelho escolhe de novo
   * em vez de herdar o do irmao. Sem perfil (modo offline, ou antes do
   * primeiro contato com o servidor) vale o guardado no aparelho.
   */
  function atual() {
    const api = typeof Api !== 'undefined' ? Api : null;
    const perfil = api && api.estado && api.estado.ligado ? api.jogadorAtual() : null;
    const id = perfil && perfil.id ? perfil.instrumento : lerLocal();
    return POR_ID[id] ? id : null;
  }

  /** Grava a escolha no aparelho e, havendo servidor, no perfil. */
  function definir(id) {
    if (!POR_ID[id]) return false;
    try {
      localStorage.setItem(CHAVE_LOCAL, id);
    } catch {
      /* armazenamento indisponivel: vale so nesta sessao */
    }
    if (typeof Api !== 'undefined' && Api.estado?.ligado && Api.definirInstrumento) {
      Api.definirInstrumento(id).catch(() => {
        /* sem rede: a escolha local continua valendo e sobe na proxima troca */
      });
    }
    return true;
  }

  // ------------------------------------------------------------------ som
  // AudioBuffers decodificados, por caminho do arquivo.
  const buffers = new Map();
  const carregando = new Map();
  // Ganho de cada gravacao para todas soarem no mesmo volume.
  const ganhos = new Map();

  // As gravacoes do FluidR3 tem pico perto de 0,1 (-20 dBFS): tocadas como
  // vieram, ficam ~5x mais baixas que o som sintetizado e os efeitos do jogo,
  // e no alto-falante do celular parecem mudas. Normalizamos cada uma para
  // este pico, que iguala o volume do som sintetizado.
  const PICO_ALVO = 0.45;
  const GANHO_MAXIMO = 8;

  function medirGanho(buf) {
    let pico = 0;
    // O trecho tocado e o primeiro segundo; e ele que importa.
    const fim = Math.min(buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const dados = buf.getChannelData(c);
      for (let i = 0; i < fim; i++) {
        const v = Math.abs(dados[i]);
        if (v > pico) pico = v;
      }
    }
    return pico > 0 ? Math.min(GANHO_MAXIMO, PICO_ALVO / pico) : 1;
  }

  const caminho = (amostra, nota) => `sons/${amostra}/${nota}.mp3`;

  function carregar(ctx, amostra, nota) {
    const arq = caminho(amostra, nota);
    if (buffers.has(arq)) return Promise.resolve(buffers.get(arq));
    if (carregando.has(arq)) return carregando.get(arq);

    const p = fetch(arq)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} em ${arq}`);
        return r.arrayBuffer();
      })
      // Forma com callbacks: o Safari antigo nao devolve Promise aqui.
      .then((dados) => new Promise((ok, falha) => ctx.decodeAudioData(dados, ok, falha)))
      .then((buf) => {
        ganhos.set(arq, medirGanho(buf));
        buffers.set(arq, buf);
        carregando.delete(arq);
        return buf;
      })
      .catch((e) => {
        carregando.delete(arq);
        console.warn('Som nao carregado:', arq, e);
        return null;
      });
    carregando.set(arq, p);
    return p;
  }

  /** Baixa e decodifica de antemao as notas de uma clave (ou de todas). */
  function precarregar(ctx, instrumentoId, clave) {
    const inst = POR_ID[instrumentoId];
    if (!inst || !ctx) return Promise.resolve();
    const claves = clave ? [clave] : inst.claves;
    return Promise.all(
      claves.flatMap((c) =>
        (NOTAS_DA_CLAVE[c] || []).map((n) => carregar(ctx, inst.amostra, notaSoando(inst.id, n)))
      )
    );
  }

  /**
   * Baixa de antemao as gravacoes de um trecho de hino (notas escritas em
   * MIDI), para a primeira nota ja sair com o som do instrumento.
   */
  function precarregarMidis(ctx, instrumentoId, midisEscritos) {
    const inst = POR_ID[instrumentoId];
    if (!inst || !ctx) return Promise.resolve();
    const notas = arquivosDo(inst.id).map((a) => ({ nota: a.nota, midi: midiDoNome(a.nota) }));
    const pedidos = new Set();
    for (const m of midisEscritos) {
      const alvo = m + inst.transposicao;
      const perto = notas.reduce((a, b) => (Math.abs(b.midi - alvo) < Math.abs(a.midi - alvo) ? b : a));
      pedidos.add(perto.nota);
    }
    return Promise.all([...pedidos].map((nota) => carregar(ctx, inst.amostra, nota)));
  }

  /**
   * Toca a nota escrita `nota` no instrumento. Devolve false se a gravacao
   * ainda nao esta pronta, para quem chamou usar o som sintetizado.
   */
  function tocar(ctx, instrumentoId, nota, duracao) {
    const inst = POR_ID[instrumentoId];
    if (!inst || !ctx) return false;
    const arq = caminho(inst.amostra, notaSoando(inst.id, nota));
    const buf = buffers.get(arq);
    if (!buf) {
      carregar(ctx, inst.amostra, notaSoando(inst.id, nota));
      return false;
    }
    reproduzir(ctx, arq, buf, 1, duracao);
    return true;
  }

  // Nota (com bemol, ex. "Eb3") -> MIDI.
  const INDICE = Object.fromEntries(NOMES.map((n, i) => [n, i]));
  const midiDoNome = (nome) => {
    const m = /^([A-G]b?)(-?\d)$/.exec(nome);
    return 12 * (Number(m[2]) + 1) + INDICE[m[1]];
  };

  // Maior desvio aceito ao reaproveitar uma gravacao vizinha. Alem disso o
  // timbre deforma; cai no som sintetizado.
  const DESVIO_MAXIMO = 5;

  /**
   * Toca uma nota ESCRITA dada em MIDI (com acidentes; usada pelos hinos).
   * Usa a gravacao mais proxima do instrumento e ajusta a altura pela
   * velocidade de reproducao. Devolve false se nao ha gravacao pronta perto.
   */
  function tocarMidi(ctx, instrumentoId, midiEscrito, duracao) {
    const inst = POR_ID[instrumentoId];
    if (!inst || !ctx) return false;
    const alvo = midiEscrito + inst.transposicao;

    const candidatas = [...new Set(arquivosDo(inst.id).map((a) => a.nota))]
      .map((nota) => ({ nota, midi: midiDoNome(nota) }))
      .sort((a, b) => Math.abs(a.midi - alvo) - Math.abs(b.midi - alvo));

    const maisProxima = candidatas[0];
    if (!maisProxima || Math.abs(maisProxima.midi - alvo) > DESVIO_MAXIMO) return false;
    if (!buffers.has(caminho(inst.amostra, maisProxima.nota))) carregar(ctx, inst.amostra, maisProxima.nota);

    const pronta = candidatas.find(
      (cand) => Math.abs(cand.midi - alvo) <= DESVIO_MAXIMO && buffers.has(caminho(inst.amostra, cand.nota))
    );
    if (!pronta) return false;
    const arq = caminho(inst.amostra, pronta.nota);
    reproduzir(ctx, arq, buffers.get(arq), Math.pow(2, (alvo - pronta.midi) / 12), duracao);
    return true;
  }

  /** Frequencia em Hz do som real de uma nota escrita em MIDI. */
  function frequenciaMidi(instrumentoId, midiEscrito) {
    const inst = POR_ID[instrumentoId];
    const midi = midiEscrito + (inst ? inst.transposicao : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function reproduzir(ctx, arq, buf, velocidade, duracao) {
    const volume = ganhos.get(arq) || 1;
    const agora = ctx.currentTime;
    const fim = agora + duracao;
    const fonte = ctx.createBufferSource();
    const ganho = ctx.createGain();
    fonte.buffer = buf;
    fonte.playbackRate.value = velocidade;
    fonte.connect(ganho);
    ganho.connect(ctx.destination);
    ganho.gain.setValueAtTime(volume, agora);
    // Corta a gravacao com uma saida suave, sem estalo.
    ganho.gain.setValueAtTime(volume, Math.max(agora, fim - 0.15));
    ganho.gain.linearRampToValueAtTime(0, fim);
    fonte.start(agora);
    fonte.stop(fim + 0.02);
  }

  return {
    NAIPES,
    LISTA,
    porId: (id) => POR_ID[id] || null,
    atual,
    definir,
    notaSoando,
    frequenciaSoando,
    arquivosDo,
    precarregar,
    tocar,
    tocarMidi,
    precarregarMidis,
    frequenciaMidi,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Instrumentos;
if (typeof window !== 'undefined') window.Instrumentos = Instrumentos;
