/**
 * Configuracao do cliente.
 *
 * apiBase vazio ('') => o jogo roda 100% offline e NUNCA toca a rede.
 *
 * Para ligar o modo online, aponte para o seu servidor:
 *   troque a linha apiBase abaixo por: https://api.seudominio.com.br
 *
 * No build do app os dois valores podem ser sobrescritos sem editar o arquivo:
 *   API_BASE=https://api.seudominio.com.br npm run sync
 *   EXIGIR_LOGIN=0 npm run sync
 *
 * exigirLogin = true  => nao se joga sem estar logado.
 *
 *   Consequencia inevitavel: a PRIMEIRA execucao precisa de internet, porque
 *   nao existe sessao guardada ainda. Depois do primeiro login o jogo volta a
 *   funcionar offline com a sessao local.
 *
 *   Consequencia na Play Store: e obrigatorio informar credenciais de teste no
 *   formulario "Acesso ao app" da Play Console, senao o revisor nao consegue
 *   entrar e a submissao e recusada.
 *
 *   exigirLogin so faz sentido com apiBase preenchido. O build recusa a
 *   combinacao (login obrigatorio + sem servidor), que geraria um app onde o
 *   portao simplesmente nao existe.
 */
window.AVENTURA_CONFIG = {
  apiBase: '',
  exigirLogin: true,
};
