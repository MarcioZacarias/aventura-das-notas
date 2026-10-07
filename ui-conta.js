/**
 * Telas de conta, perfis, progresso, ranking geral e turmas.
 *
 * Separado de game.js de proposito: o jogo em si nao precisa saber que existe
 * servidor.
 *
 * MODO PORTAO (login obrigatorio)
 *
 * Com `exigirLogin: true` em config.js, este arquivo assume o controle da
 * primeira tela: enquanto nao houver sessao, a tela de conta cobre tudo e os
 * botoes de clave ficam inacessiveis. O portao e aplicado de forma SINCRONA no
 * carregamento, antes do primeiro paint, para nao piscar a tela de jogo.
 *
 * Duas consequencias que valem lembrar:
 *  - A primeira execucao precisa de internet. Nao existe como contornar: sem
 *    sessao guardada, nao ha credencial.
 *  - Falha de REDE nao derruba a sessao. Só um 401 do servidor derruba. Assim
 *    quem ja logou uma vez continua jogando no aviao.
 *
 * A CONTA E DO ADULTO responsavel; a crianca joga sob um perfil dele.
 */
'use strict';

(function () {
  // Sem backend configurado nao existe conta nem portao.
  if (typeof Api === 'undefined' || !Api.estado.ligado) return;

  const el = (id) => document.getElementById(id);

  const startScreen = el('startScreen');
  const endScreen = el('endScreen');
  const contaScreen = el('contaScreen');
  const abrirBtn = el('abrirContaBtn');
  const contaLabel = el('contaLabel');

  const blocoDeslogado = el('contaDeslogado');
  const blocoLogado = el('contaLogado');
  const blocoComum = el('contaComum');
  const blocoSair = el('blocoSair');
  const linhaCriarTurma = el('linhaCriarTurma');

  const form = el('formConta');
  const inNome = el('inNome');
  const inEmail = el('inEmail');
  const inSenha = el('inSenha');
  const inResponsavel = el('inResponsavel');
  const campoNome = el('campoNome');
  const campoResponsavel = el('campoResponsavel');
  const enviarBtn = el('contaEnviarBtn');
  const contaMsg = el('contaMsg');

  const CLAVES = { sol: 'Clave de Sol', fa: 'Clave de Fá', do: 'Clave de Dó' };
  const MEDALHAS = { 1: '🥇', 2: '🥈', 3: '🥉' };

  const exigeLogin = Api.estado.exigeLogin === true;

  let modo = 'entrar'; // 'entrar' | 'cadastro'
  let enviando = false;
  let emPortao = false;

  // ------------------------------------------------------------------ helpers
  /**
   * Escapa texto antes de entrar em innerHTML.
   *
   * Necessario de verdade: apelidos do ranking vem de OUTRAS pessoas, e a CSP
   * do app permite script inline — markup injetado ali executaria.
   */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  function msg(elemento, texto, tipo) {
    elemento.textContent = texto || '';
    elemento.className = 'msg' + (tipo ? ' ' + tipo : '');
  }

  function duracaoLegivel(ms) {
    const min = Math.round(Number(ms || 0) / 60000);
    if (min < 1) return 'menos de 1 min';
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60);
    return h + 'h ' + (min % 60) + 'min';
  }

  // -------------------------------------------------------------- o portao
  /** Cobre o jogo com a tela de login e bloqueia o acesso as claves. */
  function ativarPortao() {
    emPortao = true;
    contaScreen.classList.add('portao');
    startScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
    el('header').style.display = 'none';
    el('staffArea').style.display = 'none';
    el('buttons').style.display = 'none';
    contaScreen.classList.remove('hidden');
    definirModo('entrar');
    renderizar();
  }

  /** Libera o jogo depois do login. */
  function liberarPortao() {
    emPortao = false;
    contaScreen.classList.remove('portao');
    contaScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    atualizarBotao();
  }

  // Aplicado JA, de forma sincrona: este script roda no fim do body, entao a
  // tela de jogo nunca chega a aparecer para quem nao tem sessao.
  if (exigeLogin && !Api.temSessao()) ativarPortao();

  // ------------------------------------------------------- botao na tela inicial
  function atualizarBotao() {
    abrirBtn.classList.remove('hidden');
    const conta = Api.contaAtual();
    const pendentes = Api.pendentes();

    // Primeiro nome, para nao estourar o botao.
    let texto = conta ? String(conta.nome || 'Minha conta').split(' ')[0] : 'Entrar';
    if (pendentes > 0) texto += ' ⏳' + pendentes;
    contaLabel.textContent = texto;
  }

  // -------------------------------------------------------------- navegacao
  function abrir() {
    startScreen.classList.add('hidden');
    contaScreen.classList.remove('hidden');
    contaScreen.scrollTop = 0;
    renderizar();
  }

  function fechar() {
    if (emPortao) return; // no portao nao ha para onde voltar
    contaScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    atualizarBotao();
  }

  // ------------------------------------------------------------ modo do form
  function definirModo(novo) {
    modo = novo;
    const cadastro = modo === 'cadastro';

    el('abaEntrar').classList.toggle('ativa', !cadastro);
    el('abaCadastro').classList.toggle('ativa', cadastro);
    campoNome.classList.toggle('hidden', !cadastro);
    campoResponsavel.classList.toggle('hidden', !cadastro);
    enviarBtn.textContent = cadastro ? 'Criar conta' : 'Entrar';
    inSenha.autocomplete = cadastro ? 'new-password' : 'current-password';
    msg(contaMsg, '');
  }

  // -------------------------------------------------------------- renderizar
  function renderizar() {
    const conta = Api.contaAtual();
    const logado = !!conta;

    blocoDeslogado.classList.toggle('hidden', logado);
    blocoLogado.classList.toggle('hidden', !logado);
    blocoSair.classList.toggle('hidden', !logado);
    // No portao nao existe sessao: perfis, ranking e turmas nao teriam o que
    // carregar, e cada chamada voltaria 401.
    blocoComum.classList.toggle('hidden', emPortao);
    // Criar turma exige conta; entrar numa turma funciona tambem no anonimo.
    linhaCriarTurma.classList.toggle('hidden', !logado);

    el('contaTitulo').textContent = emPortao ? 'Entrar para jogar' : logado ? 'Minha conta' : 'Conta';

    // O texto de explicacao muda no portao: ali ele nao e informativo, e
    // instrucao — a pessoa nao tem como seguir sem entender.
    const explica = blocoDeslogado.querySelector('.conta-explica');
    if (explica) {
      explica.innerHTML = emPortao
        ? 'Para jogar é preciso entrar com a conta do <strong>responsável</strong> — ' +
          'pai, mãe ou professor.<br>' +
          'Depois de entrar uma vez, o jogo funciona <strong>sem internet</strong>.'
        : 'A conta é do <strong>responsável</strong> — pai, mãe ou professor. Serve para ' +
          'guardar o histórico e entrar em turmas.';
    }

    if (logado) {
      el('saudacao').innerHTML =
        'Conectado como <strong>' +
        esc(conta.nome) +
        '</strong><br>' +
        esc(conta.email);
    }

    const jogador = Api.jogadorAtual();
    if (jogador) el('inApelido').value = jogador.apelido || '';

    if (!emPortao) {
      carregarPerfis();
      carregarProgresso();
      carregarRankingGeral();
      carregarTurmas();
    }
  }

  // ------------------------------------------------------------------ perfis
  async function carregarPerfis() {
    const alvo = el('listaPerfis');
    let lista;
    try {
      lista = await Api.listarJogadores();
    } catch {
      lista = null;
    }
    if (!lista || lista.length <= 1) {
      // Com um perfil so, uma lista de um item nao ajuda ninguem.
      alvo.innerHTML = '';
      return;
    }

    const atual = Api.jogadorAtual();
    alvo.innerHTML = lista
      .map(
        (j) =>
          '<div class="perfil-item' +
          (atual && j.id === atual.id ? ' ativo' : '') +
          '" data-perfil="' +
          esc(j.id) +
          '" data-apelido="' +
          esc(j.apelido) +
          '">' +
          '<span class="nome">' +
          esc(j.apelido) +
          '</span>' +
          (atual && j.id === atual.id ? '<span class="marca">jogando</span>' : '') +
          '</div>'
      )
      .join('');

    alvo.querySelectorAll('[data-perfil]').forEach((item) => {
      item.addEventListener('click', () => {
        Api.selecionarJogador({ id: item.dataset.perfil, apelido: item.dataset.apelido });
        el('inApelido').value = item.dataset.apelido;
        msg(el('perfilMsg'), 'Agora quem joga é ' + item.dataset.apelido + '.', 'ok');
        carregarPerfis();
        carregarProgresso();
        carregarRankingGeral();
      });
    });
  }

  // ---------------------------------------------------------------- progresso
  async function carregarProgresso() {
    const alvo = el('statsConteudo');
    alvo.innerHTML = '<span class="vazio">Carregando&hellip;</span>';

    let est;
    try {
      est = await Api.estatisticas();
    } catch {
      est = null;
    }

    // O perfil e criado sob demanda na primeira chamada, entao o apelido pode
    // ter acabado de existir agora: se o campo esta vazio, preenche.
    if (est && est.jogador) {
      const campo = el('inApelido');
      if (!campo.value) campo.value = est.jogador.apelido || '';
    }

    if (!est) {
      alvo.innerHTML =
        '<span class="vazio">Não foi possível falar com o servidor agora. ' +
        'Seu progresso está salvo no aparelho.</span>';
      return;
    }
    if (!est.geral || !est.geral.partidas) {
      alvo.innerHTML = '<span class="vazio">Jogue uma partida para ver seu progresso aqui.</span>';
      return;
    }

    const g = est.geral;
    const linhas = [
      ['Partidas jogadas', g.partidas],
      ['Melhor pontuação', g.recorde],
      ['Notas certas', g.acertos],
      ['Precisão', g.precisao_pct === null ? '—' : g.precisao_pct + '%'],
      ['Tempo praticando', duracaoLegivel(g.tempo_total_ms)],
    ];

    let html = linhas
      .map(
        (l) =>
          '<div class="stats-linha"><span>' +
          esc(l[0]) +
          '</span><strong>' +
          esc(l[1]) +
          '</strong></div>'
      )
      .join('');

    if (est.por_clave && est.por_clave.length) {
      html += est.por_clave
        .map(
          (c) =>
            '<div class="stats-linha"><span>' +
            esc(CLAVES[c.clave] || c.clave) +
            '</span><strong>' +
            esc(c.recorde) +
            ' <span style="font-weight:normal;color:#8d6e63">(' +
            esc(c.partidas) +
            'x)</span></strong></div>'
        )
        .join('');
    }

    alvo.innerHTML = html;
  }

  // ----------------------------------------------------------- ranking geral
  async function carregarRankingGeral() {
    const alvo = el('rankGeralConteudo');
    alvo.innerHTML = '<span class="vazio">Carregando&hellip;</span>';
    msg(el('rankMsg'), '');

    const clave = el('selRankClave').value || null;
    const periodo = el('selRankPeriodo').value || 'semana';

    let d;
    try {
      d = await Api.ranking(clave, periodo);
    } catch {
      d = null;
    }
    if (!d) {
      alvo.innerHTML = '<span class="vazio">Ranking indisponível sem conexão.</span>';
      return;
    }

    let html = '';

    // Resumo da propria posicao primeiro: e o que a pessoa quer saber.
    if (d.eu && d.eu.posicao) {
      html +=
        '<div class="resumo-eu">Você está em <strong>' +
        esc(d.eu.posicao) +
        'º</strong> de ' +
        esc(d.eu.total) +
        ' · melhor: <strong>' +
        esc(d.eu.minha_melhor) +
        '</strong>' +
        (d.eu.percentil !== null
          ? ' · à frente de <strong>' + esc(d.eu.percentil) + '%</strong> dos jogadores'
          : '') +
        '</div>';
    } else if (d.eu) {
      html +=
        '<div class="resumo-eu">Jogue nesta clave e período para entrar no ranking.</div>';
    }

    if (!d.topo || !d.topo.length) {
      html += '<span class="vazio">Ninguém pontuou neste período ainda.</span>';
      alvo.innerHTML = html;
      return;
    }

    const meuId = d.eu ? d.eu.jogador_id : null;

    html += d.topo
      .map((r) => {
        const souEu = meuId && r.jogador_id && r.jogador_id === meuId;
        // Com RANKING_MOSTRA_APELIDOS=false o servidor omite a identidade.
        const nome = d.mostra_apelidos ? esc(r.apelido) : 'Jogador ' + esc(r.posicao);
        const medalha = MEDALHAS[r.posicao] || '';
        const denuncia =
          d.mostra_apelidos && r.jogador_id && !souEu
            ? '<button class="denunciar-btn" type="button" data-denunciar="' +
              esc(r.jogador_id) +
              '" data-apelido="' +
              esc(r.apelido) +
              '">denunciar</button>'
            : '';
        return (
          '<div class="rank-linha' +
          (souEu ? ' eu' : '') +
          '">' +
          '<span class="rank-pos">' +
          (medalha || esc(r.posicao) + 'º') +
          '</span>' +
          '<span class="rank-nome">' +
          nome +
          '</span>' +
          '<strong>' +
          esc(r.melhor) +
          '</strong>' +
          denuncia +
          '</div>'
        );
      })
      .join('');

    if (d.mostra_apelidos) {
      html +=
        '<p class="nota-moderacao">Apelidos passam por filtro automático. ' +
        'Viu algo impróprio? Toque em “denunciar” — nós revisamos.</p>';
    }

    alvo.innerHTML = html;

    alvo.querySelectorAll('[data-denunciar]').forEach((botao) => {
      botao.addEventListener('click', () => denunciarApelido(botao));
    });
  }

  async function denunciarApelido(botao) {
    const apelido = botao.dataset.apelido;
    if (!confirm('Denunciar o apelido “' + apelido + '” como impróprio?')) return;

    botao.disabled = true;
    try {
      const r = await Api.denunciar(botao.dataset.denunciar, 'apelido_ofensivo');
      if (r.ok) {
        botao.textContent = r.jaDenunciado ? 'já denunciado' : 'denunciado';
        msg(el('rankMsg'), 'Obrigado. Vamos revisar esse apelido.', 'ok');
      } else {
        botao.disabled = false;
        msg(el('rankMsg'), r.erro, 'erro');
      }
    } catch {
      botao.disabled = false;
      msg(el('rankMsg'), 'Sem conexão para enviar a denúncia.', 'erro');
    }
  }

  // ------------------------------------------------------------------ turmas
  async function carregarTurmas() {
    const alvo = el('turmasConteudo');
    alvo.innerHTML = '';

    let dados;
    try {
      dados = await Api.minhasTurmas();
    } catch {
      dados = null;
    }
    if (!dados) return;

    const administro = dados.administro || [];
    const participando = dados.participando || [];

    if (!administro.length && !participando.length) {
      alvo.innerHTML =
        '<span class="vazio">Nenhuma turma ainda. Use um código de convite ' +
        'para entrar numa, ou crie a sua.</span>';
      return;
    }

    const vistos = new Set();
    const cartoes = [];

    for (const t of administro) {
      vistos.add(t.id);
      cartoes.push({
        id: t.id,
        nome: t.nome,
        codigo: t.codigo,
        detalhe: (t.membros || 0) + ' participante(s)',
      });
    }
    for (const t of participando) {
      if (vistos.has(t.id)) continue;
      vistos.add(t.id);
      cartoes.push({ id: t.id, nome: t.nome, codigo: null, detalhe: 'Você participa' });
    }

    alvo.innerHTML = cartoes
      .map(
        (c) =>
          '<div class="turma-cartao">' +
          '<h4>' +
          esc(c.nome) +
          '</h4>' +
          (c.codigo
            ? '<div>Código: <span class="turma-codigo">' + esc(c.codigo) + '</span></div>'
            : '') +
          '<div class="vazio">' +
          esc(c.detalhe) +
          '</div>' +
          '<button class="mini-btn" type="button" data-ranking="' +
          esc(c.id) +
          '" style="margin-top:7px">Ver ranking</button>' +
          '<div data-rank-de="' +
          esc(c.id) +
          '"></div>' +
          '</div>'
      )
      .join('');

    alvo.querySelectorAll('[data-ranking]').forEach((botao) => {
      botao.addEventListener('click', () => mostrarRankingTurma(botao.dataset.ranking, botao));
    });

    const meuJogador = Api.jogadorAtual();
    alvo.dataset.meuJogador = meuJogador ? meuJogador.id : '';
  }

  async function mostrarRankingTurma(turmaId, botao) {
    const destino = document.querySelector('[data-rank-de="' + turmaId + '"]');
    if (!destino) return;

    // Segundo clique fecha.
    if (destino.dataset.aberto === '1') {
      destino.innerHTML = '';
      destino.dataset.aberto = '0';
      botao.textContent = 'Ver ranking';
      return;
    }

    destino.innerHTML = '<span class="vazio">Carregando&hellip;</span>';
    let dados;
    try {
      dados = await Api.rankingTurma(turmaId);
    } catch {
      dados = null;
    }

    if (!dados || !dados.ranking || !dados.ranking.length) {
      destino.innerHTML = '<span class="vazio">Ninguém jogou nesta turma ainda.</span>';
      destino.dataset.aberto = '1';
      botao.textContent = 'Esconder';
      return;
    }

    const meu = el('turmasConteudo').dataset.meuJogador;
    destino.innerHTML =
      '<div style="margin-top:7px">' +
      dados.ranking
        .map(
          (r) =>
            '<div class="rank-linha' +
            (r.id === meu ? ' eu' : '') +
            '">' +
            '<span class="rank-pos">' +
            esc(r.posicao) +
            'º</span>' +
            '<span class="rank-nome">' +
            esc(r.apelido) +
            '</span>' +
            '<strong>' +
            esc(r.melhor === null ? '—' : r.melhor) +
            '</strong>' +
            '</div>'
        )
        .join('') +
      '</div>';
    destino.dataset.aberto = '1';
    botao.textContent = 'Esconder';
  }

  // ------------------------------------------------------------------ eventos
  abrirBtn.addEventListener('click', abrir);
  el('contaVoltarBtn').addEventListener('click', fechar);
  el('abaEntrar').addEventListener('click', () => definirModo('entrar'));
  el('abaCadastro').addEventListener('click', () => definirModo('cadastro'));
  el('selRankClave').addEventListener('change', carregarRankingGeral);
  el('selRankPeriodo').addEventListener('change', carregarRankingGeral);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;

    const email = inEmail.value.trim();
    const senha = inSenha.value;
    const nome = inNome.value.trim();

    if (!email || !senha) {
      msg(contaMsg, 'Preencha e-mail e senha.', 'erro');
      return;
    }
    if (modo === 'cadastro') {
      if (nome.length < 2) {
        msg(contaMsg, 'Informe o nome do responsável.', 'erro');
        return;
      }
      if (!inResponsavel.checked) {
        msg(contaMsg, 'É preciso confirmar que você é o responsável.', 'erro');
        return;
      }
    }

    enviando = true;
    enviarBtn.disabled = true;
    msg(contaMsg, modo === 'cadastro' ? 'Criando conta…' : 'Entrando…');

    let r;
    try {
      r =
        modo === 'cadastro'
          ? await Api.cadastrar({ email, senha, nome })
          : await Api.entrar({ email, senha });
    } catch {
      r = { ok: false, erro: 'Não foi possível falar com o servidor. Verifique a conexão.' };
    } finally {
      enviando = false;
      enviarBtn.disabled = false;
    }

    if (!r.ok) {
      msg(contaMsg, r.erro, 'erro');
      return;
    }

    inSenha.value = '';
    msg(contaMsg, '');

    if (emPortao) {
      // Entrou: libera o jogo e sai da tela de conta.
      emPortao = false;
      contaScreen.classList.remove('portao');
      liberarPortao();
    } else {
      renderizar();
      atualizarBotao();
    }
    Api.sincronizar().catch(() => {});
  });

  el('salvarApelidoBtn').addEventListener('click', async () => {
    const apelido = el('inApelido').value.trim();
    if (apelido.length < 2) {
      msg(el('perfilMsg'), 'O apelido precisa de pelo menos 2 letras.', 'erro');
      return;
    }
    msg(el('perfilMsg'), 'Salvando…');
    try {
      const r = await Api.atualizarJogador({ apelido });
      msg(el('perfilMsg'), r.ok ? 'Salvo!' : r.erro, r.ok ? 'ok' : 'erro');
      if (r.ok) {
        carregarPerfis();
        carregarRankingGeral();
      }
    } catch {
      msg(el('perfilMsg'), 'Sem conexão com o servidor.', 'erro');
    }
  });

  el('addPerfilBtn').addEventListener('click', async () => {
    const apelido = el('inNovoPerfil').value.trim();
    if (apelido.length < 2) {
      msg(el('perfilMsg'), 'Dê um apelido de pelo menos 2 letras.', 'erro');
      return;
    }
    msg(el('perfilMsg'), 'Criando…');
    try {
      const r = await Api.criarJogador(apelido);
      if (r.ok) {
        el('inNovoPerfil').value = '';
        el('inApelido').value = r.jogador.apelido;
        msg(el('perfilMsg'), 'Perfil criado. Agora quem joga é ' + r.jogador.apelido + '.', 'ok');
        carregarPerfis();
        carregarProgresso();
      } else {
        msg(el('perfilMsg'), r.erro, 'erro');
      }
    } catch {
      msg(el('perfilMsg'), 'Sem conexão com o servidor.', 'erro');
    }
  });

  el('entrarTurmaBtn').addEventListener('click', async () => {
    const codigo = el('inCodigoTurma').value.trim().toUpperCase();
    if (codigo.length !== 6) {
      msg(el('turmaMsg'), 'O código tem 6 caracteres.', 'erro');
      return;
    }
    msg(el('turmaMsg'), 'Entrando…');
    try {
      const r = await Api.entrarTurma(codigo);
      if (r.ok) {
        msg(el('turmaMsg'), 'Você entrou em ' + r.turma.nome + '!', 'ok');
        el('inCodigoTurma').value = '';
        carregarTurmas();
      } else {
        msg(el('turmaMsg'), r.erro, 'erro');
      }
    } catch {
      msg(el('turmaMsg'), 'Sem conexão com o servidor.', 'erro');
    }
  });

  el('criarTurmaBtn').addEventListener('click', async () => {
    const nome = el('inNomeTurma').value.trim();
    if (nome.length < 2) {
      msg(el('turmaMsg'), 'Dê um nome à turma.', 'erro');
      return;
    }
    msg(el('turmaMsg'), 'Criando…');
    try {
      const r = await Api.criarTurma(nome);
      if (r.ok) {
        msg(el('turmaMsg'), 'Turma criada! Código: ' + r.turma.codigo, 'ok');
        el('inNomeTurma').value = '';
        carregarTurmas();
      } else {
        msg(el('turmaMsg'), r.erro, 'erro');
      }
    } catch {
      msg(el('turmaMsg'), 'Sem conexão com o servidor.', 'erro');
    }
  });

  el('sairBtn').addEventListener('click', async () => {
    try {
      await Api.sair();
    } catch {
      /* segue: o estado local ja foi limpo */
    }
    inEmail.value = '';
    inSenha.value = '';
    if (exigeLogin) {
      // Login obrigatorio: sair volta para o portao, nao para o jogo.
      ativarPortao();
    } else {
      definirModo('entrar');
      renderizar();
      atualizarBotao();
    }
  });

  // ------------------------------------------------------------------- inicio
  definirModo('entrar');
  atualizarBotao();

  // Este arquivo, e nao game.js, e o dono da sessao.
  Api.init()
    .then((r) => {
      if (exigeLogin && r.precisaLogin) {
        if (!emPortao) ativarPortao();
        return;
      }
      if (emPortao) liberarPortao();
      atualizarBotao();
    })
    .catch((e) => {
      console.warn('Api.init:', e);
      // Falha inesperada com login obrigatorio: melhor barrar do que liberar.
      if (exigeLogin && !Api.temSessao() && !emPortao) ativarPortao();
    });

  // O contador de pendentes muda quando a fila escoa em segundo plano.
  setInterval(atualizarBotao, 4000);
})();
