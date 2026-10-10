/**
 * "Instalar" o jogo como app (PWA): registra o service worker e mostra o
 * botao 📲 Instalar na tela inicial.
 *
 * - Android/Chrome/Edge: usa o pedido de instalacao do navegador.
 * - iPhone/iPad (Safari): a Apple nao deixa instalar por botao; mostramos o
 *   passo a passo (Compartilhar -> Adicionar a Tela de Inicio).
 * - Ja aberto como app, ou dentro do APK (Capacitor): o botao nao aparece.
 */
'use strict';

(function () {
  const nativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const jaInstalado =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // Service worker: so na web (o APK ja tem os arquivos dentro dele).
  if (!nativo && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker:', e));
    });
  }

  const btn = document.getElementById('instalarBtn');
  const dica = document.getElementById('instalarDica');
  if (!btn || nativo || jaInstalado) return;

  const ua = navigator.userAgent || '';
  const ehIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let pedido = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedido = e;
    btn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    btn.classList.add('hidden');
    pedido = null;
  });

  if (ehIOS) btn.classList.remove('hidden');

  btn.addEventListener('click', async () => {
    if (pedido) {
      pedido.prompt();
      const escolha = await pedido.userChoice.catch(() => null);
      if (escolha && escolha.outcome === 'accepted') btn.classList.add('hidden');
      pedido = null;
      return;
    }
    // iOS (ou navegador sem pedido automatico): passo a passo.
    document.getElementById('instalarPassos').innerHTML = ehIOS
      ? '1. Toque em <strong>Compartilhar</strong> <span class="ios-share">⬆︎</span> na barra do Safari.<br>' +
        '2. Escolha <strong>Adicionar à Tela de Início</strong>.<br>3. Toque em <strong>Adicionar</strong>.'
      : '1. Abra o menu do navegador (<strong>⋮</strong>).<br>' +
        '2. Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.';
    dica.classList.remove('hidden');
  });

  document.getElementById('instalarDicaOk').addEventListener('click', () => dica.classList.add('hidden'));
})();
