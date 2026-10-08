/**
 * Painel do administrador: nivel minimo dos hinos e cadastro de hinos.
 *
 * Usa a mesma sessao do jogo (api.js). Quem decide se a conta e
 * administradora e o servidor (ADMIN_EMAILS); esta tela so esconde o painel
 * de quem nao e, e as rotas /v1/admin/* recusam do mesmo jeito.
 */
'use strict';

(function () {
  const el = (id) => document.getElementById(id);
  const mostrar = (id, sim) => el(id).classList.toggle('hidden', !sim);

  function msg(alvo, texto, tipo) {
    alvo.textContent = texto || '';
    alvo.className = 'msg' + (tipo ? ' ' + tipo : '');
  }

  const erroDe = (r, padrao) =>
    (r && r.dados && (r.dados.detalhes ? r.dados.detalhes.join('; ') : r.dados.erro)) || padrao;

  const CLAVES = [
    { id: 'sol', campo: 'fTrechoSol', previa: 'pTrechoSol' },
    { id: 'fa', campo: 'fTrechoFa', previa: 'pTrechoFa' },
    { id: 'do', campo: 'fTrechoDo', previa: 'pTrechoDo' },
  ];

  let hinos = [];
  let editando = null; // hino em edicao, ou null para novo

  // --------------------------------------------------------------- entrada
  async function iniciar() {
    if (typeof Api === 'undefined' || !Api.estado.ligado) {
      mostrar('semServidor', true);
      return;
    }
    if (!Api.temSessao()) {
      mostrar('blocoLogin', true);
      return;
    }
    let conta = null;
    try {
      conta = await Api.eu();
    } catch {
      /* rede */
    }
    mostrar('sairBtn', true);
    if (!conta) {
      // Sessao invalida ou sem rede.
      mostrar('blocoLogin', true);
      msg(el('loginMsg'), 'Entre novamente para continuar.', 'erro');
      return;
    }
    if (!conta.admin) {
      mostrar('semAcesso', true);
      return;
    }
    mostrar('painel', true);
    montarSelects();
    carregarConfig();
    carregarHinos();
  }

  el('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('loginBtn');
    btn.disabled = true;
    msg(el('loginMsg'), 'Entrando…');
    let r;
    try {
      r = await Api.entrar({ email: el('inEmail').value.trim(), senha: el('inSenha').value });
    } catch {
      r = { ok: false, erro: 'Sem conexão com o servidor.' };
    }
    btn.disabled = false;
    if (!r.ok) {
      msg(el('loginMsg'), r.erro, 'erro');
      return;
    }
    el('inSenha').value = '';
    mostrar('blocoLogin', false);
    msg(el('loginMsg'), '');
    iniciar();
  });

  el('sairBtn').addEventListener('click', async () => {
    await Api.sair().catch(() => {});
    location.reload();
  });

  // --------------------------------------------------------- configuracao
  async function carregarConfig() {
    const r = await Api.admin('GET', '/config').catch(() => null);
    if (r && r.ok) el('inNivelMinimo').value = r.dados.hinos_nivel_minimo;
    else msg(el('configMsg'), erroDe(r, 'Não foi possível carregar.'), 'erro');
  }

  el('salvarConfigBtn').addEventListener('click', async () => {
    const nivel = Number(el('inNivelMinimo').value);
    if (!Number.isInteger(nivel) || nivel < 1 || nivel > 100) {
      msg(el('configMsg'), 'Informe um nível entre 1 e 100.', 'erro');
      return;
    }
    msg(el('configMsg'), 'Salvando…');
    const r = await Api.admin('PATCH', '/config', { hinos_nivel_minimo: nivel }).catch(() => null);
    msg(el('configMsg'), r && r.ok ? 'Salvo!' : erroDe(r, 'Não foi possível salvar.'), r && r.ok ? 'ok' : 'erro');
  });

  // ------------------------------------------------------------------ lista
  async function carregarHinos() {
    msg(el('listaMsg'), 'Carregando…');
    const r = await Api.admin('GET', '/hinos').catch(() => null);
    if (!r || !r.ok) {
      msg(el('listaMsg'), erroDe(r, 'Não foi possível carregar os hinos.'), 'erro');
      return;
    }
    hinos = r.dados.hinos;
    msg(el('listaMsg'), hinos.length ? '' : 'Nenhum hino cadastrado ainda.');
    desenharLista();
  }

  function desenharLista() {
    const corpo = el('listaHinos');
    corpo.innerHTML = '';
    for (const h of hinos) {
      const tr = document.createElement('tr');
      if (!h.ativo) tr.className = 'inativo';
      const tom = Hinos.tom(h.tom);
      const claves = CLAVES.filter((c) => h.trechos[c.id])
        .map((c) => ({ sol: 'Sol', fa: 'Fá', do: 'Dó' })[c.id])
        .join(', ');
      const celulas = [
        String(h.numero),
        h.nome + (h.ativo ? '' : ' (inativo)'),
        tom ? tom.nome : h.tom,
        h.compasso + ' · ' + Hinos.tipoCompasso(h.compasso),
        claves,
      ];
      for (const texto of celulas) {
        const td = document.createElement('td');
        td.textContent = texto;
        tr.appendChild(td);
      }
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secundario pequeno';
      btn.textContent = 'Editar';
      btn.addEventListener('click', () => abrirForm(h));
      td.appendChild(btn);
      tr.appendChild(td);
      corpo.appendChild(tr);
    }
  }

  // ----------------------------------------------------------- formulario
  function montarSelects() {
    const tom = el('fTom');
    tom.innerHTML = '';
    for (const t of Hinos.TONS) {
      const o = document.createElement('option');
      o.value = t.id;
      const n = Math.abs(t.armadura);
      o.textContent = t.nome + (n ? ` (${n} ${t.armadura > 0 ? '♯' : '♭'})` : '');
      tom.appendChild(o);
    }
    const comp = el('fCompasso');
    comp.innerHTML = '';
    for (const c of Hinos.COMPASSOS) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      comp.appendChild(o);
    }
    comp.value = '4/4';
    atualizarTipoCompasso();
  }

  function atualizarTipoCompasso() {
    el('fTipoCompasso').textContent = Hinos.tipoCompasso(el('fCompasso').value);
  }
  el('fCompasso').addEventListener('change', atualizarTipoCompasso);

  function abrirForm(hino) {
    editando = hino || null;
    el('formTitulo').textContent = hino ? `Editar hino ${hino.numero}` : 'Novo hino';
    el('fNumero').value = hino ? hino.numero : '';
    el('fNome').value = hino ? hino.nome : '';
    el('fTom').value = hino ? hino.tom : 'C';
    el('fCompasso').value = hino ? hino.compasso : '4/4';
    el('fAndamento').value = hino && hino.andamento ? hino.andamento : '';
    el('fAtivo').checked = hino ? hino.ativo : true;
    for (const c of CLAVES) {
      el(c.campo).value = hino && hino.trechos[c.id] ? Hinos.paraTexto(hino.trechos[c.id]) : '';
    }
    atualizarTipoCompasso();
    atualizarPrevias();
    mostrar('excluirBtn', !!hino);
    msg(el('formMsg'), '');
    mostrar('blocoForm', true);
    el('blocoForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    el('fNumero').focus();
  }

  el('novoHinoBtn').addEventListener('click', () => abrirForm(null));
  el('cancelarBtn').addEventListener('click', () => {
    mostrar('blocoForm', false);
    editando = null;
  });

  /** Le um trecho do formulario: { tokens, erros, notas }. */
  function lerTrecho(clave) {
    const c = CLAVES.find((x) => x.id === clave);
    const { tokens, erros } = Hinos.deTexto(el(c.campo).value, clave);
    if (tokens.length > 64) erros.push('No máximo 64 notas por trecho.');
    if (tokens.length === 1) erros.push('O trecho precisa de pelo menos 2 notas.');
    const armadura = (Hinos.tom(el('fTom').value) || { armadura: 0 }).armadura;
    const notas = erros.length ? [] : Hinos.notasDoTrecho(tokens.join(' '), clave, armadura);
    return { tokens, erros, notas };
  }

  function atualizarPrevias() {
    for (const c of CLAVES) {
      const alvo = el(c.previa);
      const { tokens, erros, notas } = lerTrecho(c.id);
      alvo.innerHTML = '';
      if (!tokens.length && !erros.length) continue;
      if (notas.length) {
        alvo.textContent = `${notas.length} notas: ` + notas.map((n) => n.label).join(' ');
      }
      for (const e of erros) {
        const span = document.createElement('span');
        span.className = 'erro';
        span.textContent = e;
        alvo.appendChild(span);
      }
    }
  }
  for (const c of CLAVES) el(c.campo).addEventListener('input', atualizarPrevias);
  el('fTom').addEventListener('change', atualizarPrevias);

  // Previa sonora simples (sintetizada), so para conferir a melodia.
  let audioCtx = null;
  document.querySelectorAll('[data-ouvir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { notas } = lerTrecho(btn.dataset.ouvir);
      if (!notas.length) return;
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const bpm = Number(el('fAndamento').value) || 80;
      const passo = 60 / bpm;
      let t = audioCtx.currentTime + 0.05;
      for (const n of notas) {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + passo * 0.9);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + passo);
        t += passo;
      }
    });
  });

  el('formHino').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tom = Hinos.tom(el('fTom').value);
    const corpo = {
      numero: Number(el('fNumero').value),
      nome: el('fNome').value.trim(),
      tom: tom.id,
      armadura: tom.armadura,
      compasso: el('fCompasso').value,
      ativo: el('fAtivo').checked,
    };
    const andamento = Number(el('fAndamento').value);
    if (andamento) corpo.andamento = andamento;

    let algum = false;
    for (const c of CLAVES) {
      const { tokens, erros } = lerTrecho(c.id);
      if (erros.length) {
        msg(el('formMsg'), `Corrija o trecho da clave de ${{ sol: 'Sol', fa: 'Fá', do: 'Dó' }[c.id]}.`, 'erro');
        return;
      }
      if (tokens.length) {
        corpo[`trecho_${c.id}`] = tokens.join(' ');
        algum = true;
      } else if (editando) {
        corpo[`trecho_${c.id}`] = ''; // apaga o trecho desta clave
      }
    }
    if (!algum) {
      msg(el('formMsg'), 'Cadastre o trecho de pelo menos uma clave.', 'erro');
      return;
    }

    const btn = el('salvarHinoBtn');
    btn.disabled = true;
    msg(el('formMsg'), 'Salvando…');
    const r = await (editando
      ? Api.admin('PATCH', `/hinos/${editando.id}`, corpo)
      : Api.admin('POST', '/hinos', corpo)
    ).catch(() => null);
    btn.disabled = false;
    if (!r || !r.ok) {
      msg(el('formMsg'), erroDe(r, 'Não foi possível salvar.'), 'erro');
      return;
    }
    mostrar('blocoForm', false);
    editando = null;
    await carregarHinos();
    msg(el('listaMsg'), 'Hino salvo.', 'ok');
  });

  el('excluirBtn').addEventListener('click', async () => {
    if (!editando) return;
    if (!confirm(`Excluir o hino ${editando.numero} - ${editando.nome}? Não dá para desfazer.`)) return;
    const r = await Api.admin('DELETE', `/hinos/${editando.id}`).catch(() => null);
    if (!r || !r.ok) {
      msg(el('formMsg'), erroDe(r, 'Não foi possível excluir.'), 'erro');
      return;
    }
    mostrar('blocoForm', false);
    editando = null;
    await carregarHinos();
    msg(el('listaMsg'), 'Hino excluído.', 'ok');
  });

  iniciar();
})();
