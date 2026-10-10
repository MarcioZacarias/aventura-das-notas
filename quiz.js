/**
 * Quiz do Metodo Simplificado de Aprendizado Musical (MSA) da CCB.
 *
 * Aparece ao escolher a clave, antes da partida: 3 perguntas, com botao de
 * pular. As perguntas seguem as fases do metodo: o aluno comeca na Fase 1 e
 * libera a proxima ao acertar ACERTOS_PARA_AVANCAR perguntas da fase atual.
 * O progresso fica no aparelho, separado por jogador.
 *
 * As perguntas (quiz-perguntas.js) foram escritas a partir do conteudo do
 * metodo; nao sao trechos copiados do livro.
 *
 * So aprendizado: nao mexe em pontuacao nem ranking.
 */
'use strict';

const Quiz = (() => {
  const POR_RODADA = 3;
  const ACERTOS_PARA_AVANCAR = 5;
  // Fatia das perguntas que vem da fase atual; o resto revisa fases anteriores.
  const PESO_FASE_ATUAL = 2;

  const perguntas = typeof QUIZ_PERGUNTAS !== 'undefined' ? QUIZ_PERGUNTAS : [];
  const fases = [...new Set(perguntas.map((p) => p.fase))].sort((a, b) => a - b);

  // ------------------------------------------------------------- progresso
  function chave() {
    const jog = typeof Api !== 'undefined' && Api.jogadorAtual ? Api.jogadorAtual() : null;
    return 'adn.quiz.' + (jog && jog.id ? jog.id : 'aparelho');
  }

  function progresso() {
    try {
      const p = JSON.parse(localStorage.getItem(chave()) || 'null');
      if (p && typeof p.fase === 'number') return p;
    } catch {
      /* ignora */
    }
    return { fase: fases[0] || 1, acertos: 0, vistas: [] };
  }

  function salvar(p) {
    try {
      localStorage.setItem(chave(), JSON.stringify(p));
    } catch {
      /* sem armazenamento: vale so nesta sessao */
    }
  }

  const titulos = typeof QUIZ_FASES !== 'undefined' ? QUIZ_FASES : {};
  const tituloDaFase = (fase) => titulos[fase] || '';

  // ---------------------------------------------------------------- sorteio
  function embaralhar(lista) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Prefere perguntas que o aluno ainda nao viu (ou viu ha mais tempo). */
  function escolher(pool, n, vistas) {
    const rank = (p) => {
      const i = vistas.indexOf(p.id);
      return i === -1 ? -1 : i;
    };
    return embaralhar(pool)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, n);
  }

  function rodada(prog) {
    const atuais = perguntas.filter((p) => p.fase === prog.fase);
    const anteriores = perguntas.filter((p) => p.fase < prog.fase);
    const nAtual = anteriores.length ? Math.min(PESO_FASE_ATUAL, atuais.length) : POR_RODADA;
    const sel = escolher(atuais, nAtual, prog.vistas).concat(
      escolher(anteriores, POR_RODADA - nAtual, prog.vistas)
    );
    return embaralhar(sel.slice(0, POR_RODADA));
  }

  // ---------------------------------------------------------------- tela
  const el = (id) => document.getElementById(id);
  let aoTerminar = null;
  let estado = null;

  function mostrarPergunta() {
    const p = estado.lista[estado.i];
    el('quizContador').textContent = `Pergunta ${estado.i + 1} de ${estado.lista.length}`;
    el('quizFase').textContent = `Fase ${p.fase} · ${tituloDaFase(p.fase)}`;
    el('quizPergunta').textContent = p.pergunta;
    el('quizExplicacao').classList.add('hidden');
    el('quizProximaBtn').classList.add('hidden');

    const alvo = el('quizOpcoes');
    alvo.innerHTML = '';
    // Embaralha as alternativas, guardando qual e a certa.
    const ops = embaralhar(p.opcoes.map((texto, idx) => ({ texto, certa: idx === p.correta })));
    for (const op of ops) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiz-opcao';
      b.textContent = op.texto;
      b.addEventListener('click', () => responder(b, op.certa, p));
      alvo.appendChild(b);
    }
  }

  function responder(botao, certa, p) {
    if (estado.respondida) return;
    estado.respondida = true;
    const botoes = el('quizOpcoes').querySelectorAll('.quiz-opcao');
    botoes.forEach((b) => {
      b.disabled = true;
      if (b.textContent === p.opcoes[p.correta]) b.classList.add('certa');
    });
    if (!certa) botao.classList.add('errada');

    const prog = estado.prog;
    prog.vistas = [p.id].concat(prog.vistas.filter((id) => id !== p.id)).slice(0, 200);
    if (certa) {
      estado.acertos++;
      if (p.fase === prog.fase) prog.acertos++;
    }

    const exp = el('quizExplicacao');
    exp.textContent = (certa ? '✅ Isso mesmo! ' : '❌ Quase! ') + p.explicacao;
    exp.className = 'quiz-explicacao ' + (certa ? 'ok' : 'erro');
    el('quizProximaBtn').textContent = estado.i + 1 < estado.lista.length ? 'Próxima ➜' : 'Ver resultado';
    el('quizProximaBtn').classList.remove('hidden');
  }

  function proxima() {
    estado.i++;
    estado.respondida = false;
    if (estado.i < estado.lista.length) {
      mostrarPergunta();
      return;
    }
    // Fim da rodada: talvez avance de fase.
    const prog = estado.prog;
    let subiu = false;
    const idx = fases.indexOf(prog.fase);
    if (prog.acertos >= ACERTOS_PARA_AVANCAR && idx !== -1 && idx + 1 < fases.length) {
      prog.fase = fases[idx + 1];
      prog.acertos = 0;
      subiu = true;
    }
    salvar(prog);

    el('quizPergunta').textContent = `Você acertou ${estado.acertos} de ${estado.lista.length}!`;
    el('quizOpcoes').innerHTML = '';
    el('quizContador').textContent = '';
    el('quizFase').textContent = '';
    const exp = el('quizExplicacao');
    exp.className = 'quiz-explicacao ' + (subiu ? 'ok' : '');
    exp.textContent = subiu
      ? `🎉 Parabéns! Você liberou a Fase ${prog.fase} do método: ${tituloDaFase(prog.fase)}.`
      : `Fase ${prog.fase} · ${tituloDaFase(prog.fase)}: ${Math.min(prog.acertos, ACERTOS_PARA_AVANCAR)} de ${ACERTOS_PARA_AVANCAR} acertos para avançar.`;
    el('quizProximaBtn').textContent = 'Jogar! 🎵';
    el('quizProximaBtn').classList.remove('hidden');
    estado.fim = true;
  }

  function fechar() {
    el('quizScreen').classList.add('hidden');
    const fn = aoTerminar;
    aoTerminar = null;
    estado = null;
    if (fn) fn();
  }

  /** Mostra o quiz e chama `depois` ao terminar ou pular. */
  function abrir(depois) {
    if (!perguntas.length) {
      depois();
      return;
    }
    const prog = progresso();
    if (!fases.includes(prog.fase)) prog.fase = fases[0];
    aoTerminar = depois;
    estado = { prog, lista: rodada(prog), i: 0, acertos: 0, respondida: false, fim: false };
    el('quizScreen').scrollTop = 0;
    el('quizScreen').classList.remove('hidden');
    mostrarPergunta();
  }

  if (typeof document !== 'undefined' && document.getElementById('quizScreen')) {
    el('quizProximaBtn').addEventListener('click', () => (estado && estado.fim ? fechar() : proxima()));
    el('quizPularBtn').addEventListener('click', () => {
      if (estado && estado.i > 0) salvar(estado.prog);
      fechar();
    });
  }

  return { abrir, progresso, fases, total: perguntas.length };
})();

if (typeof window !== 'undefined') window.Quiz = Quiz;
