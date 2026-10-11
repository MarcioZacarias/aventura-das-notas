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
    carregarUsuarios();
    carregarSugestoes();
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

  // ------------------------------------------------------------- usuarios
  const usuarios = { pagina: 1, aberta: null };
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  function etiqueta(texto, classe) {
    const t = document.createElement('span');
    t.className = 'tag ' + classe;
    t.textContent = texto;
    return t;
  }

  async function carregarUsuarios() {
    const qs = new URLSearchParams({ situacao: el('filtroUsuario').value, pagina: String(usuarios.pagina) });
    const busca = el('buscaUsuario').value.trim();
    if (busca) qs.set('busca', busca);
    msg(el('usuariosMsg'), 'Carregando…');
    const r = await Api.admin('GET', '/contas?' + qs.toString()).catch(() => null);
    if (!r || !r.ok) {
      msg(el('usuariosMsg'), erroDe(r, 'Não foi possível carregar os usuários.'), 'erro');
      return;
    }
    const d = r.dados;
    const res = d.resumo;
    el('resumoUsuarios').innerHTML = '';
    for (const [n, t] of [[res.contas, 'contas'], [res.ativas_7_dias, 'ativas em 7 dias'], [res.jogadores, 'perfis'], [res.aparelhos, 'aparelhos'], [res.banidas, 'banidas']]) {
      const div = document.createElement('div');
      const s = document.createElement('strong');
      s.textContent = n;
      const sp = document.createElement('span');
      sp.textContent = t;
      div.append(s, sp);
      el('resumoUsuarios').appendChild(div);
    }

    const corpo = el('listaUsuarios');
    corpo.innerHTML = '';
    for (const u of d.contas) {
      const tr = document.createElement('tr');
      if (u.banida_em) tr.className = 'banida';
      const tdNome = document.createElement('td');
      tdNome.textContent = u.nome;
      if (u.admin) tdNome.appendChild(etiqueta('admin', 'adm'));
      if (u.banida_em) tdNome.appendChild(etiqueta('banida', 'ban'));
      if (u.apelidos) {
        const ap = document.createElement('div');
        ap.className = 'claves-tag';
        ap.textContent = u.apelidos;
        tdNome.appendChild(ap);
      }
      tr.appendChild(tdNome);
      for (const t of [u.email, String(u.jogadores), String(u.partidas), dataBr(u.ultimo_acesso_em)]) {
        const td = document.createElement('td');
        td.textContent = t;
        tr.appendChild(td);
      }
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secundario pequeno';
      b.textContent = 'Gerenciar';
      b.addEventListener('click', () => abrirFicha(u.id));
      td.appendChild(b);
      tr.appendChild(td);
      corpo.appendChild(tr);
    }
    const paginas = Math.max(1, Math.ceil(d.total / d.por_pagina));
    el('usuariosPagina').textContent = d.total + ' conta(s) · página ' + usuarios.pagina + ' de ' + paginas;
    el('usuariosAnteriorBtn').disabled = usuarios.pagina <= 1;
    el('usuariosProximaBtn').disabled = usuarios.pagina >= paginas;
    msg(el('usuariosMsg'), d.contas.length ? '' : 'Nenhuma conta encontrada.');
  }

  let buscaTimer = null;
  el('buscaUsuario').addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => { usuarios.pagina = 1; carregarUsuarios(); }, 350);
  });
  el('filtroUsuario').addEventListener('change', () => { usuarios.pagina = 1; carregarUsuarios(); });
  el('usuariosAnteriorBtn').addEventListener('click', () => { usuarios.pagina--; carregarUsuarios(); });
  el('usuariosProximaBtn').addEventListener('click', () => { usuarios.pagina++; carregarUsuarios(); });

  async function abrirFicha(id) {
    usuarios.aberta = id;
    msg(el('fichaMsg'), 'Carregando…');
    mostrar('fichaConta', true);
    el('fichaConta').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const r = await Api.admin('GET', '/contas/' + id).catch(() => null);
    if (!r || !r.ok) {
      msg(el('fichaMsg'), erroDe(r, 'Não foi possível abrir a conta.'), 'erro');
      return;
    }
    const { conta, jogadores, sessoes_abertas, turmas, sugestoes } = r.dados;
    el('fichaTitulo').textContent = conta.nome + (conta.admin ? ' (administrador)' : '');
    el('fichaInfo').textContent = conta.email + ' · conta criada em ' + dataBr(conta.criado_em) +
      ' · último acesso ' + dataBr(conta.ultimo_acesso_em) + ' · ' + turmas.length + ' turma(s) · ' + sugestoes + ' sugestão(ões)';
    el('fichaNome').value = conta.nome;
    el('fichaConfirmarEmail').value = '';
    el('fichaSessoes').textContent = sessoes_abertas
      ? 'Conectada em ' + sessoes_abertas + ' aparelho(s)/navegador(es).'
      : 'Nenhuma sessão aberta no momento.';

    const banida = !!conta.banida_em;
    mostrar('fichaBanida', banida);
    el('fichaBanida').textContent = banida
      ? '🚫 Conta banida em ' + dataBr(conta.banida_em) + (conta.ban_motivo ? ' — motivo: ' + conta.ban_motivo : '')
      : '';
    el('fichaMotivo').value = conta.ban_motivo || '';
    mostrar('fichaBanirBtn', !banida && !conta.admin);
    mostrar('fichaDesbanirBtn', banida);
    el('fichaExcluirBtn').disabled = conta.admin;
    el('fichaBanBloco').style.opacity = conta.admin ? 0.5 : 1;

    const alvo = el('fichaJogadores');
    alvo.innerHTML = '';
    if (!jogadores.length) alvo.innerHTML = '<p class="ajuda">Nenhum perfil.</p>';
    for (const jg of jogadores) {
      const linha = document.createElement('div');
      linha.className = 'perfil-linha';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.maxLength = 20;
      inp.value = jg.apelido;
      const info = document.createElement('span');
      info.className = 'ajuda';
      info.textContent = (jg.instrumento || 'sem instrumento') + ' · ' + jg.partidas + ' partida(s) · recorde ' + (jg.recorde ?? 0);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pequeno';
      b.textContent = 'Renomear';
      b.addEventListener('click', async () => {
        const rr = await Api.admin('PATCH', '/jogadores/' + jg.id, { apelido: inp.value.trim() }).catch(() => null);
        msg(el('fichaMsg'), rr && rr.ok ? 'Apelido alterado.' : erroDe(rr, 'Não foi possível alterar.'), rr && rr.ok ? 'ok' : 'erro');
        if (rr && rr.ok) carregarUsuarios();
      });
      linha.append(inp, info, b);
      alvo.appendChild(linha);
    }
    msg(el('fichaMsg'), '');
  }

  async function acaoConta(metodo, sufixo, corpo, sucesso) {
    const id = usuarios.aberta;
    if (!id) return false;
    const r = await Api.admin(metodo, '/contas/' + id + sufixo, corpo).catch(() => null);
    if (!r || !r.ok) {
      msg(el('fichaMsg'), erroDe(r, 'Não foi possível concluir.'), 'erro');
      return false;
    }
    await carregarUsuarios();
    if (metodo !== 'DELETE') await abrirFicha(id);
    msg(el('fichaMsg'), sucesso(r.dados), 'ok');
    return true;
  }

  el('fichaFecharBtn').addEventListener('click', () => { mostrar('fichaConta', false); usuarios.aberta = null; });
  el('fichaSalvarNomeBtn').addEventListener('click', () =>
    acaoConta('PATCH', '', { nome: el('fichaNome').value.trim() }, () => 'Nome salvo.'));
  el('fichaEncerrarBtn').addEventListener('click', () =>
    acaoConta('POST', '/encerrar-sessoes', undefined, (d) => 'Desconectada de ' + d.encerradas + ' sessão(ões).'));
  el('fichaBanirBtn').addEventListener('click', () => {
    if (!confirm('Banir esta conta? Ela será desconectada e não conseguirá entrar.')) return;
    acaoConta('PATCH', '', { banida: true, motivo: el('fichaMotivo').value }, () => 'Conta banida.');
  });
  el('fichaDesbanirBtn').addEventListener('click', () =>
    acaoConta('PATCH', '', { banida: false }, () => 'Banimento removido. A pessoa já pode entrar de novo.'));
  el('fichaExcluirBtn').addEventListener('click', async () => {
    const email = el('fichaConfirmarEmail').value.trim();
    if (!email) {
      msg(el('fichaMsg'), 'Digite o e-mail da conta para confirmar.', 'erro');
      return;
    }
    if (!confirm('Excluir definitivamente esta conta e todos os dados dela?')) return;
    const ok = await acaoConta('DELETE', '', { confirmar_email: email }, () => 'Conta excluída.');
    if (ok) {
      mostrar('fichaConta', false);
      usuarios.aberta = null;
      msg(el('usuariosMsg'), 'Conta excluída.', 'ok');
    }
  });

  // ------------------------------------------------------------ sugestoes
  const ESTADOS_SUG = [
    ['recebida', 'Recebida'],
    ['em_avaliacao', 'Em avaliação'],
    ['aceita', 'Aceita'],
    ['implementada', 'Implementada ✅'],
    ['recusada', 'Recusada'],
  ];

  async function carregarSugestoes() {
    const filtro = el('filtroSugestao').value;
    msg(el('sugestoesMsg'), 'Carregando…');
    const r = await Api.admin('GET', '/sugestoes' + (filtro ? '?estado=' + filtro : '')).catch(() => null);
    if (!r || !r.ok) {
      msg(el('sugestoesMsg'), erroDe(r, 'Não foi possível carregar as sugestões.'), 'erro');
      return;
    }
    const alvo = el('listaSugestoesAdmin');
    alvo.innerHTML = '';
    const lista = r.dados.sugestoes;
    msg(el('sugestoesMsg'), lista.length ? '' : 'Nenhuma sugestão por aqui.');
    for (const s of lista) {
      const card = document.createElement('div');
      card.className = 'sug';
      const topo = document.createElement('div');
      topo.className = 'sug-topo';
      const quem = document.createElement('span');
      quem.textContent = '#' + s.id + ' · ' + s.autor_nome + (s.apelido ? ' (jogador: ' + s.apelido + ')' : '');
      const quando = document.createElement('span');
      quando.textContent = new Date(s.criado_em).toLocaleString('pt-BR');
      topo.append(quem, quando);
      const texto = document.createElement('p');
      texto.className = 'sug-texto';
      texto.textContent = s.texto;

      const acoes = document.createElement('div');
      acoes.className = 'sug-acoes';
      const sel = document.createElement('select');
      for (const [v, t] of ESTADOS_SUG) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = s.estado;
      const resp = document.createElement('textarea');
      resp.maxLength = 500;
      resp.placeholder = 'Resposta para o autor (opcional)';
      resp.value = s.resposta || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pequeno';
      btn.textContent = 'Salvar';
      const aviso = document.createElement('p');
      aviso.className = 'msg';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const rr = await Api.admin('PATCH', '/sugestoes/' + s.id, { estado: sel.value, resposta: resp.value }).catch(() => null);
        btn.disabled = false;
        if (rr && rr.ok) {
          msg(aviso, sel.value === 'implementada' ? 'Salvo! O autor vai receber o aviso no jogo. 🎉' : 'Salvo!', 'ok');
        } else {
          msg(aviso, erroDe(rr, 'Não foi possível salvar.'), 'erro');
        }
      });
      acoes.append(sel, resp, btn);
      card.append(topo, texto, acoes, aviso);
      alvo.appendChild(card);
    }
  }
  el('filtroSugestao').addEventListener('change', carregarSugestoes);

  iniciar();
})();
