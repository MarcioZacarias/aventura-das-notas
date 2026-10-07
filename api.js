/**
 * Camada de rede do jogo — offline-first.
 *
 * Regras que este modulo respeita, em ordem de prioridade:
 *
 *  1. O JOGO NUNCA ESPERA A REDE. Toda partida e gravada localmente na hora.
 *     Se a API responder depois, otimo; se nunca responder, o jogo segue
 *     funcionando igual.
 *  2. Nada aqui pode lancar excecao para fora. Falha de rede e estado normal,
 *     nao erro. Por isso praticamente tudo esta dentro de try/catch.
 *  3. Sem apiBase configurado, nenhuma requisicao e feita. O app publicado
 *     offline continua offline.
 *
 * A fila de envio e idempotente: cada partida carrega um cliente_partida_id
 * (UUID gerado aqui) e o servidor ignora reenvios. Isso permite reenviar sem
 * medo de duplicar o historico.
 */
'use strict';

const Api = (() => {
  const cfg = (typeof window !== 'undefined' && window.AVENTURA_CONFIG) || {};
  const BASE = String(cfg.apiBase || '').replace(/\/+$/, '');

  const K = {
    dispositivo: 'adn.dispositivo',
    tokenAcesso: 'adn.token',
    refresh: 'adn.refresh',
    jogador: 'adn.jogador',
    fila: 'adn.fila',
    recordes: 'adn.recordes',
    conta: 'adn.conta',
  };

  // ----------------------------------------------------------- armazenamento
  // localStorage pode lancar (modo privado, cota, WebView restrito). Nunca
  // deixamos isso derrubar o jogo.
  function ler(chave, padrao = null) {
    try {
      const v = localStorage.getItem(chave);
      return v === null ? padrao : JSON.parse(v);
    } catch {
      return padrao;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch {
      return false;
    }
  }

  function apagar(chave) {
    try {
      localStorage.removeItem(chave);
    } catch {
      /* ignora */
    }
  }

  function uuid() {
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {
      /* cai no fallback */
    }
    // Fallback para WebView antigo sem randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ------------------------------------------------------------------- estado
  const estado = {
    ligado: BASE !== '',
    // Login obrigatorio: sem sessao de conta, nao existe credencial e o jogo
    // nao libera. Consequencia inevitavel: a PRIMEIRA execucao precisa de
    // internet. Depois disso a sessao guardada permite jogar offline.
    exigeLogin: cfg.exigirLogin === true,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    sincronizando: false,
    ultimoErro: null,
  };

  /** Ha sessao de conta guardada neste aparelho? (checagem local, sem rede) */
  const temSessao = () => !!ler(K.refresh);

  function limparSessao() {
    apagar(K.refresh);
    apagar(K.conta);
    apagar(K.tokenAcesso);
  }

  // ------------------------------------------------------------------- HTTP
  async function http(metodo, caminho, { corpo, token, tempoLimiteMs = 8000 } = {}) {
    if (!estado.ligado) throw new Error('modo offline');

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), tempoLimiteMs);
    try {
      const r = await fetch(BASE + caminho, {
        method: metodo,
        headers: {
          ...(corpo ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: controle.signal,
      });
      let dados = null;
      try {
        dados = await r.json();
      } catch {
        /* sem corpo */
      }
      return { status: r.status, dados, ok: r.ok };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Requisicao autenticada, renovando a credencial uma vez em caso de 401. */
  async function autenticado(metodo, caminho, corpo) {
    let token = ler(K.tokenAcesso);
    if (!token) {
      token = await garantirCredencial();
      if (!token) throw new Error('sem credencial');
    }

    let r = await http(metodo, caminho, { corpo, token });
    if (r.status !== 401) return r;

    // Token expirou: renova e tenta de novo, uma unica vez.
    token = await renovarCredencial();
    if (!token) throw new Error('nao foi possivel renovar credencial');
    return http(metodo, caminho, { corpo, token });
  }

  // ------------------------------------------------------------ credenciais
  /** Registra o aparelho no primeiro uso. Nenhum dado pessoal e enviado. */
  async function garantirCredencial() {
    const jaTem = ler(K.tokenAcesso);
    if (jaTem) return jaTem;

    // Com login obrigatorio a unica credencial possivel vem da conta: nao
    // criamos identidade anonima de aparelho, senao o portao teria como ser
    // contornado.
    if (estado.exigeLogin) {
      return temSessao() ? renovarCredencial() : null;
    }

    const disp = ler(K.dispositivo);
    if (disp?.dispositivo_id && disp?.segredo) return renovarCredencial();

    const plataforma =
      typeof window !== 'undefined' && window.Capacitor?.getPlatform
        ? window.Capacitor.getPlatform()
        : 'web';

    const r = await http('POST', '/v1/auth/dispositivo/registrar', {
      corpo: { plataforma: ['android', 'ios', 'web'].includes(plataforma) ? plataforma : 'web' },
    });
    if (!r.ok) throw new Error(`registro do aparelho falhou (${r.status})`);

    gravar(K.dispositivo, {
      dispositivo_id: r.dados.dispositivo_id,
      segredo: r.dados.segredo,
    });
    gravar(K.tokenAcesso, r.dados.access_token);
    return r.dados.access_token;
  }

  /** Renova o access token: por conta (refresh) ou por aparelho (segredo). */
  async function renovarCredencial() {
    const refresh = ler(K.refresh);
    if (refresh) {
      const r = await http('POST', '/v1/auth/renovar', { corpo: { refresh_token: refresh } });
      if (r.ok) {
        gravar(K.tokenAcesso, r.dados.access_token);
        gravar(K.refresh, r.dados.refresh_token);
        return r.dados.access_token;
      }
      // Sessao morreu de verdade (o servidor recusou o refresh).
      apagar(K.refresh);
      apagar(K.conta);
      // Com login obrigatorio, isso significa voltar para a tela de login —
      // nao cair para uma identidade anonima.
      if (estado.exigeLogin) return null;
    }

    if (estado.exigeLogin) return null;

    const disp = ler(K.dispositivo);
    if (!disp?.dispositivo_id || !disp?.segredo) return garantirCredencial();

    const r = await http('POST', '/v1/auth/dispositivo/entrar', {
      corpo: { dispositivo_id: disp.dispositivo_id, segredo: disp.segredo },
    });
    if (!r.ok) return null;
    gravar(K.tokenAcesso, r.dados.access_token);
    return r.dados.access_token;
  }

  /** Garante que existe um jogador (perfil) e devolve o id. */
  async function garantirJogador(apelidoPadrao = 'Eu') {
    const local = ler(K.jogador);
    if (local?.id) return local.id;

    const lista = await autenticado('GET', '/v1/jogadores');
    if (lista.ok && lista.dados?.jogadores?.length) {
      gravar(K.jogador, lista.dados.jogadores[0]);
      return lista.dados.jogadores[0].id;
    }

    const criado = await autenticado('POST', '/v1/jogadores', {
      apelido: apelidoPadrao,
      avatar: 'musica',
    });
    if (!criado.ok) throw new Error(`nao foi possivel criar o jogador (${criado.status})`);
    gravar(K.jogador, criado.dados.jogador);
    return criado.dados.jogador.id;
  }

  // ------------------------------------------------------- recordes locais
  // Fonte de verdade para o que a tela mostra. Funciona sem rede e sem conta.
  function recordeLocal(clave) {
    const r = ler(K.recordes, {});
    return r[clave] || 0;
  }

  function atualizarRecordeLocal(clave, pontuacao) {
    const r = ler(K.recordes, {});
    const anterior = r[clave] || 0;
    if (pontuacao > anterior) {
      r[clave] = pontuacao;
      gravar(K.recordes, r);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- fila
  const MAX_FILA = 200;

  function enfileirar(partida) {
    const fila = ler(K.fila, []);
    fila.push(partida);
    // Corta as mais antigas se estourar: melhor perder historico velho do que
    // encher o armazenamento do aparelho.
    gravar(K.fila, fila.slice(-MAX_FILA));
  }

  /**
   * Tenta enviar tudo o que esta pendente. Seguro chamar a qualquer momento:
   * sai calado se estiver offline, desligado ou ja sincronizando.
   */
  async function sincronizar() {
    if (!estado.ligado || estado.sincronizando) return { enviadas: 0 };
    const fila = ler(K.fila, []);
    if (!fila.length) return { enviadas: 0 };

    estado.sincronizando = true;
    // Guardamos os ids RESOLVIDOS em vez de reconstruir a fila.
    //
    // Duas armadilhas que isso evita:
    //  1. Se a rede cai no meio, os itens ainda nao percorridos precisam
    //     continuar na fila — reconstruir a lista os apagaria.
    //  2. registrarPartida() pode enfileirar uma partida nova ENQUANTO este
    //     envio roda. Sobrescrever a fila no fim apagaria essa partida.
    // Removendo apenas o que foi resolvido, os dois casos ficam corretos.
    const resolvidas = new Set();
    let enviadas = 0;

    try {
      const jogadorId = await garantirJogador();

      for (const p of fila) {
        try {
          const r = await autenticado('POST', '/v1/partidas', { ...p, jogador_id: jogadorId });

          // 2xx = gravada ou duplicada.
          // 4xx = o servidor recusou pelo conteudo (ex.: partida implausivel).
          //       Reenviar nao muda nada, entao descartamos — senao a fila
          //       trava para sempre nesse item e nada mais e enviado.
          if (r.ok || (r.status >= 400 && r.status < 500)) {
            resolvidas.add(p.cliente_partida_id);
            enviadas++;
            if (!r.ok) {
              console.warn('Partida recusada pelo servidor, descartada:', r.dados?.erro);
            }
          } else {
            break; // 5xx: servidor com problema, tenta tudo de novo depois
          }
        } catch {
          break; // rede caiu: para aqui, o resto continua na fila
        }
      }
      estado.ultimoErro = null;
    } catch (e) {
      estado.ultimoErro = e.message;
    } finally {
      if (resolvidas.size) {
        const atual = ler(K.fila, []);
        gravar(
          K.fila,
          atual.filter((p) => !resolvidas.has(p.cliente_partida_id))
        );
      }
      estado.sincronizando = false;
    }
    return { enviadas };
  }

  // ------------------------------------------------------------- API publica
  /**
   * Registra uma partida encerrada. Grava local imediatamente e tenta enviar
   * em segundo plano — sem bloquear a tela de fim de jogo.
   */
  function registrarPartida({ clave, pontuacao, acertos, erros, nivel_max, duracao_ms }) {
    const novoRecorde = atualizarRecordeLocal(clave, pontuacao);

    if (estado.ligado) {
      enfileirar({
        cliente_partida_id: uuid(),
        clave,
        pontuacao,
        acertos,
        erros,
        nivel_max,
        duracao_ms,
      });
      // Dispara e esquece: erro aqui nao afeta o jogo.
      sincronizar().catch(() => {});
    }

    return { novoRecorde, recorde: recordeLocal(clave) };
  }

  async function cadastrar({ email, senha, nome }) {
    const r = await http('POST', '/v1/auth/cadastro', {
      corpo: { email, senha, nome, responsavel_confirmado: true },
    });
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };

    gravar(K.tokenAcesso, r.dados.access_token);
    gravar(K.refresh, r.dados.refresh_token);
    gravar(K.conta, r.dados.conta);
    await vincularPerfilDoAparelho();
    return { ok: true, conta: r.dados.conta };
  }

  async function entrar({ email, senha }) {
    const r = await http('POST', '/v1/auth/entrar', { corpo: { email, senha } });
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };

    gravar(K.tokenAcesso, r.dados.access_token);
    gravar(K.refresh, r.dados.refresh_token);
    gravar(K.conta, r.dados.conta);
    apagar(K.jogador); // recarrega o perfil vindo da conta
    await vincularPerfilDoAparelho();
    return { ok: true, conta: r.dados.conta };
  }

  /** Leva o historico jogado sem cadastro para dentro da conta recem-criada. */
  async function vincularPerfilDoAparelho() {
    const disp = ler(K.dispositivo);
    if (!disp?.dispositivo_id || !disp?.segredo) return;
    try {
      await autenticado('POST', '/v1/jogadores/vincular', {
        dispositivo_id: disp.dispositivo_id,
        segredo: disp.segredo,
      });
      apagar(K.jogador);
    } catch {
      /* nao critico: o vinculo pode ser tentado de novo depois */
    }
  }

  async function sair() {
    const refresh = ler(K.refresh);
    if (refresh) {
      try {
        await http('POST', '/v1/auth/sair', { corpo: { refresh_token: refresh } });
      } catch {
        /* ignora */
      }
    }
    apagar(K.refresh);
    apagar(K.conta);
    apagar(K.tokenAcesso);
    apagar(K.jogador);
  }

  async function estatisticas() {
    const jogadorId = await garantirJogador();
    const r = await autenticado('GET', `/v1/jogadores/${jogadorId}/estatisticas`);
    return r.ok ? r.dados : null;
  }

  /**
   * Ranking geral. Inclui a propria posicao apenas se ja existe um perfil —
   * assim, so olhar o ranking nao cria perfil no servidor.
   */
  async function ranking(clave, periodo = 'semana') {
    let caminho = `/v1/ranking?periodo=${encodeURIComponent(periodo)}`;
    if (clave) caminho += `&clave=${encodeURIComponent(clave)}`;

    const meu = ler(K.jogador);
    if (meu?.id) caminho += `&jogador_id=${encodeURIComponent(meu.id)}`;

    const r = await autenticado('GET', caminho);
    return r.ok ? r.dados : null;
  }

  // ------------------------------------------------------------- perfil
  /** Perfil em uso neste aparelho (cacheado localmente). */
  const jogadorAtual = () => ler(K.jogador);

  /** Renomeia o perfil / troca o avatar. */
  async function atualizarJogador({ apelido, avatar, instrumento }) {
    const id = await garantirJogador();
    const corpo = {};
    if (apelido !== undefined) corpo.apelido = apelido;
    if (avatar !== undefined) corpo.avatar = avatar;
    if (instrumento !== undefined) corpo.instrumento = instrumento;

    const r = await autenticado('PATCH', `/v1/jogadores/${id}`, corpo);
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };
    gravar(K.jogador, r.dados.jogador);
    return { ok: true, jogador: r.dados.jogador };
  }

  /**
   * Instrumento do perfil atual. Grava no perfil local na hora (a tela usa
   * isso imediatamente, mesmo offline) e depois tenta subir para o servidor.
   */
  async function definirInstrumento(instrumento) {
    const local = ler(K.jogador);
    if (local?.id) gravar(K.jogador, { ...local, instrumento });
    if (exigeLoginSemSessao()) return { ok: false, erro: 'sem sessao' };
    return atualizarJogador({ instrumento });
  }

  /**
   * Atualiza o perfil local com o do servidor (o instrumento pode ter sido
   * escolhido em outro aparelho). Uma escolha feita offline que ainda nao
   * subiu nao e apagada: ela sobe agora.
   */
  async function carregarPerfil() {
    if (!estado.ligado || exigeLoginSemSessao()) return jogadorAtual();
    const id = await garantirJogador();
    const lista = await listarJogadores();
    const doServidor = lista?.find((j) => j.id === id);
    if (!doServidor) return jogadorAtual();

    const local = jogadorAtual();
    if (!doServidor.instrumento && local?.id === id && local.instrumento) {
      gravar(K.jogador, { ...doServidor, instrumento: local.instrumento });
      atualizarJogador({ instrumento: local.instrumento }).catch(() => {});
    } else {
      gravar(K.jogador, doServidor);
    }
    return jogadorAtual();
  }

  // Com login obrigatorio e sem sessao nao ha credencial; nem tenta a rede.
  const exigeLoginSemSessao = () => estado.exigeLogin && !temSessao();

  /** Todos os perfis da conta (uma familia ou turma tem varios). */
  async function listarJogadores() {
    const r = await autenticado('GET', '/v1/jogadores');
    return r.ok ? r.dados.jogadores : null;
  }

  async function criarJogador(apelido, avatar) {
    const r = await autenticado('POST', '/v1/jogadores', {
      apelido,
      avatar: avatar || 'musica',
    });
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };
    gravar(K.jogador, r.dados.jogador);
    return { ok: true, jogador: r.dados.jogador };
  }

  /** Define qual perfil esta jogando agora neste aparelho. */
  function selecionarJogador(jogador) {
    if (!jogador?.id) return false;
    gravar(K.jogador, jogador);
    return true;
  }

  // ---------------------------------------------------------- denuncia
  /**
   * Denuncia um apelido ofensivo visto no ranking. E a segunda barreira de
   * moderacao — a primeira e o filtro no servidor, que nao pega tudo.
   */
  async function denunciar(jogadorId, motivo, observacao) {
    const corpo = { jogador_id: jogadorId, motivo: motivo || 'apelido_ofensivo' };
    if (observacao) corpo.observacao = observacao;
    const r = await autenticado('POST', '/v1/denuncias', corpo);
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };
    return { ok: true, jaDenunciado: r.dados?.ja_denunciado === true };
  }

  // ------------------------------------------------------------- turmas
  async function minhasTurmas() {
    const r = await autenticado('GET', '/v1/turmas');
    return r.ok ? r.dados : null;
  }

  async function criarTurma(nome) {
    const r = await autenticado('POST', '/v1/turmas', { nome });
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };
    return { ok: true, turma: r.dados.turma };
  }

  async function entrarTurma(codigo) {
    const jogadorId = await garantirJogador();
    const r = await autenticado('POST', '/v1/turmas/entrar', {
      codigo: String(codigo).trim().toUpperCase(),
      jogador_id: jogadorId,
    });
    if (!r.ok) return { ok: false, erro: r.dados?.erro || `Falha (${r.status})` };
    return { ok: true, turma: r.dados.turma };
  }

  async function rankingTurma(turmaId, clave, periodo = 'todos') {
    // Query string montada a mao, como no resto do arquivo: evita depender de
    // URLSearchParams, que nao existe em WebView muito antigo.
    let caminho = `/v1/turmas/${encodeURIComponent(turmaId)}/ranking?periodo=${encodeURIComponent(periodo)}`;
    if (clave) caminho += `&clave=${encodeURIComponent(clave)}`;
    const r = await autenticado('GET', caminho);
    return r.ok ? r.dados : null;
  }

  const contaAtual = () => ler(K.conta);
  const pendentes = () => ler(K.fila, []).length;

  /**
   * Prepara credencial e escoa a fila. Chamar uma vez ao carregar o jogo.
   * @returns {Promise<{ligado: boolean, precisaLogin: boolean, pendentes?: number}>}
   */
  async function init() {
    if (!estado.ligado) return { ligado: false, precisaLogin: false };

    if (estado.exigeLogin) {
      if (!temSessao()) return { ligado: true, precisaLogin: true };

      // Existe sessao guardada. Tentamos renovar, mas com uma distincao que
      // importa: servidor RECUSANDO o refresh (401) significa sessao morta e
      // volta ao login; falha de REDE nao significa nada sobre a sessao, e
      // nesse caso deixamos jogar offline com o que esta guardado.
      try {
        const token = await renovarCredencial();
        if (!token) {
          limparSessao();
          return { ligado: true, precisaLogin: true };
        }
      } catch (e) {
        estado.ultimoErro = e.message;
        return { ligado: true, precisaLogin: false, offline: true };
      }

      try {
        await sincronizar();
      } catch (e) {
        estado.ultimoErro = e.message;
      }
      return { ligado: true, precisaLogin: false, pendentes: pendentes() };
    }

    try {
      await garantirCredencial();
      await sincronizar();
    } catch (e) {
      estado.ultimoErro = e.message;
    }
    return { ligado: true, precisaLogin: false, pendentes: pendentes() };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      estado.online = true;
      sincronizar().catch(() => {});
    });
    window.addEventListener('offline', () => {
      estado.online = false;
    });
  }

  return {
    estado,
    init,
    registrarPartida,
    recordeLocal,
    sincronizar,
    pendentes,
    cadastrar,
    entrar,
    sair,
    contaAtual,
    estatisticas,
    ranking,
    temSessao,
    jogadorAtual,
    atualizarJogador,
    definirInstrumento,
    carregarPerfil,
    listarJogadores,
    criarJogador,
    selecionarJogador,
    denunciar,
    minhasTurmas,
    criarTurma,
    entrarTurma,
    rankingTurma,
  };
})();

if (typeof window !== 'undefined') window.Api = Api;
