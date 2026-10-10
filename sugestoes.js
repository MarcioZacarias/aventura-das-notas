/**
 * Sugestoes dos usuarios: botao 💡 na tela inicial, envio, acompanhamento e
 * o aviso de "sua sugestao foi implementada".
 *
 * So existe com servidor (sem apiBase o botao nem aparece). Ninguem ve a
 * sugestao de outra pessoa: so o autor e o administrador (admin.html).
 */
'use strict';

const Sugestoes = (() => {
  const el = (id) => document.getElementById(id);
  const ligado = () => typeof Api !== 'undefined' && Api.estado && Api.estado.ligado;

  const ESTADO = {
    recebida: { texto: 'Recebida', icone: '📬', classe: 'recebida' },
    em_avaliacao: { texto: 'Em avaliação', icone: '🔎', classe: 'avaliacao' },
    aceita: { texto: 'Aceita! Vamos fazer', icone: '👍', classe: 'aceita' },
    implementada: { texto: 'Implementada!', icone: '🎉', classe: 'implementada' },
    recusada: { texto: 'Não será feita', icone: '💬', classe: 'recusada' },
  };

  let lista = [];

  function msg(texto, tipo) {
    const m = el('sugestaoMsg');
    m.textContent = texto || '';
    m.className = 'msg' + (tipo ? ' ' + tipo : '');
  }

  const dataCurta = (iso) => {
    try {
      return new Date(iso).toLocaleDateString('pt-BR');
    } catch {
      return '';
    }
  };

  function desenharLista() {
    const alvo = el('listaSugestoes');
    alvo.innerHTML = '';
    if (!lista.length) {
      alvo.innerHTML = '<p class="vazio">Você ainda não enviou sugestões.</p>';
      return;
    }
    for (const s of lista) {
      const e = ESTADO[s.estado] || ESTADO.recebida;
      const item = document.createElement('div');
      item.className = 'sugestao-item' + (s.autor_viu ? '' : ' novidade');
      const topo = document.createElement('div');
      topo.className = 'sugestao-topo-item';
      const etiqueta = document.createElement('span');
      etiqueta.className = 'sugestao-estado ' + e.classe;
      etiqueta.textContent = e.icone + ' ' + e.texto;
      const data = document.createElement('span');
      data.className = 'sugestao-data';
      data.textContent = dataCurta(s.criado_em);
      topo.append(etiqueta, data);
      const texto = document.createElement('p');
      texto.className = 'sugestao-texto';
      texto.textContent = s.texto;
      item.append(topo, texto);
      if (s.resposta) {
        const resp = document.createElement('p');
        resp.className = 'sugestao-resposta';
        resp.textContent = 'Resposta: ' + s.resposta;
        item.appendChild(resp);
      }
      alvo.appendChild(item);
    }
  }

  function atualizarPonto() {
    const tem = lista.some((s) => !s.autor_viu);
    el('sugestaoPonto').classList.toggle('hidden', !tem);
  }

  async function carregar() {
    try {
      const r = await Api.minhasSugestoes();
      if (r) lista = r;
    } catch {
      /* sem rede: mostra o que tiver */
    }
    atualizarPonto();
    return lista;
  }

  async function abrir() {
    msg('');
    el('sugestaoScreen').classList.remove('hidden');
    el('startScreen').classList.add('hidden');
    el('listaSugestoes').innerHTML = '<p class="vazio">Carregando…</p>';
    await carregar();
    desenharLista();
    // Abriu a tela: as novidades foram vistas.
    if (lista.some((s) => !s.autor_viu)) {
      Api.marcarSugestoesVistas().catch(() => {});
      lista = lista.map((s) => ({ ...s, autor_viu: true }));
      atualizarPonto();
    }
  }

  function fechar() {
    el('sugestaoScreen').classList.add('hidden');
    el('startScreen').classList.remove('hidden');
  }

  async function enviar() {
    const campo = el('inSugestao');
    const texto = campo.value.trim();
    if (texto.length < 5) {
      msg('Escreva sua sugestão com pelo menos 5 letras.', 'erro');
      return;
    }
    const btn = el('enviarSugestaoBtn');
    btn.disabled = true;
    msg('Enviando…');
    let r;
    try {
      r = await Api.enviarSugestao(texto);
    } catch {
      r = { ok: false, erro: 'Sem conexão com o servidor. Tente de novo mais tarde.' };
    }
    btn.disabled = false;
    if (!r.ok) {
      msg(r.erro, 'erro');
      return;
    }
    campo.value = '';
    el('sugestaoContador').textContent = '0/1000';
    msg('Obrigado! Sua sugestão foi enviada e vai ser avaliada. 💡', 'ok');
    lista = [r.sugestao, ...lista];
    desenharLista();
  }

  /**
   * Procura sugestoes implementadas que o autor ainda nao viu e comemora.
   * Chamada depois do login / ao carregar o perfil.
   */
  async function verificar() {
    if (!ligado()) return;
    await carregar();
    const novas = lista.filter((s) => !s.autor_viu && s.estado === 'implementada');
    if (!novas.length) return;
    const s = novas[0];
    el('sugestaoFestaTexto').textContent = '“' + s.texto + '”';
    el('sugestaoFestaResposta').textContent = s.resposta || '';
    el('sugestaoFestaResposta').classList.toggle('hidden', !s.resposta);
    el('sugestaoFestaMais').textContent =
      novas.length > 1 ? `E mais ${novas.length - 1} sugestão(ões) sua(s) também foi(ram) implementada(s)!` : '';
    el('sugestaoFesta').classList.remove('hidden');
  }

  function fecharFesta() {
    el('sugestaoFesta').classList.add('hidden');
    Api.marcarSugestoesVistas().catch(() => {});
    lista = lista.map((s) => ({ ...s, autor_viu: true }));
    atualizarPonto();
  }

  if (typeof document !== 'undefined' && el('abrirSugestaoBtn')) {
    // Sem servidor nao ha onde guardar sugestoes.
    el('abrirSugestaoBtn').classList.toggle('hidden', !ligado());
    el('abrirSugestaoBtn').addEventListener('click', abrir);
    el('sugestaoVoltarBtn').addEventListener('click', fechar);
    el('enviarSugestaoBtn').addEventListener('click', enviar);
    el('inSugestao').addEventListener('input', () => {
      el('sugestaoContador').textContent = el('inSugestao').value.length + '/1000';
    });
    el('sugestaoFestaOk').addEventListener('click', fecharFesta);
    el('sugestaoFestaVer').addEventListener('click', () => {
      fecharFesta();
      abrir();
    });
  }

  return { verificar, abrir };
})();

if (typeof window !== 'undefined') window.Sugestoes = Sugestoes;
