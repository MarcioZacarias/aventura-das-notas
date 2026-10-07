/**
 * Testa api.js (a camada de rede do jogo) contra a API real.
 *
 * api.js foi escrito para rodar no WebView, entao aqui simulamos window,
 * localStorage e navigator, carregamos o arquivo num contexto de vm e
 * exercitamos o fluxo — incluindo queda de rede, que e o comportamento mais
 * importante de verificar num app offline-first.
 *
 *   docker compose up -d
 *   node server/teste-cliente.mjs [http://localhost:3000]
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

let passou = 0;
let falhou = 0;
function ok(nome, condicao, extra = '') {
  if (condicao) {
    passou++;
    console.log(`  \x1b[32mPASSOU\x1b[0m  ${nome}`);
  } else {
    falhou++;
    console.log(`  \x1b[31mFALHOU\x1b[0m  ${nome}${extra ? ` -> ${extra}` : ''}`);
  }
}

// --- ambiente de navegador simulado ---------------------------------------
function criarLocalStorage() {
  const mapa = new Map();
  return {
    getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => mapa.set(k, String(v)),
    removeItem: (k) => mapa.delete(k),
    get tamanho() {
      return mapa.size;
    },
  };
}

// Interruptor para simular queda de rede.
let redeLigada = true;
const fetchReal = globalThis.fetch;
const fetchControlado = (...args) => {
  if (!redeLigada) return Promise.reject(new TypeError('fetch failed'));
  return fetchReal(...args);
};

const FONTE_API = readFileSync(join(raiz, 'api.js'), 'utf8');

/**
 * Carrega uma instancia ISOLADA de api.js, com localStorage e config proprios.
 * Isolar importa: o teste do portao de login precisa de um aparelho "virgem",
 * sem a sessao que os testes anteriores deixaram.
 */
function criarApi(config) {
  const janela = {
    AVENTURA_CONFIG: { apiBase: BASE, ...config },
    addEventListener: () => {},
  };
  const contexto = createContext({
    window: janela,
    localStorage: criarLocalStorage(),
    navigator: { onLine: true },
    fetch: fetchControlado,
    crypto: globalThis.crypto,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
  });
  runInContext(FONTE_API, contexto, { filename: 'api.js' });
  // api.js declara `const Api` no topo, que num script vm nao vira propriedade
  // do global — ele se expoe via window.Api, exatamente como faz no WebView.
  return janela.Api;
}

const Api = criarApi({});

const partida = (pontuacao = 10, clave = 'sol') => ({
  clave,
  pontuacao,
  acertos: pontuacao,
  erros: 3,
  nivel_max: 1 + Math.floor(pontuacao / 8),
  duracao_ms: 60000,
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nTestando api.js contra ${BASE}\n`);

// -------------------------------------------------------------------- init
console.log('Inicializacao');
{
  ok('carregou o modulo Api', typeof Api === 'object' && typeof Api.init === 'function');
  ok('detectou modo online', Api.estado.ligado === true);

  const r = await Api.init();
  ok('init registra o aparelho', r.ligado === true, JSON.stringify(r));
}

// ------------------------------------------------------- partida com rede
console.log('\nPartida com rede disponivel');
{
  const r = Api.registrarPartida(partida(10));
  ok('grava recorde local na hora (sincrono)', r.novoRecorde === true && r.recorde === 10);

  await esperar(1200); // deixa o envio em segundo plano concluir
  ok('fila escoou', Api.pendentes() === 0, `${Api.pendentes()} pendente(s)`);

  const menor = Api.registrarPartida(partida(4));
  ok('pontuacao menor nao vira recorde', menor.novoRecorde === false && menor.recorde === 10);

  await esperar(800);
  const est = await Api.estatisticas();
  ok('estatisticas vem do servidor', est !== null && est.geral?.partidas === 2,
     JSON.stringify(est?.geral));
  ok('recorde do servidor bate com o local', est?.geral?.recorde === 10);
}

// ------------------------------------------------ SEM rede (offline-first)
console.log('\nQueda de rede (offline-first)');
{
  redeLigada = false;

  const r = Api.registrarPartida(partida(18));
  ok('recorde local funciona sem rede', r.novoRecorde === true && r.recorde === 18);

  await esperar(500);
  ok('partida fica na fila', Api.pendentes() === 1, `${Api.pendentes()} pendente(s)`);

  Api.registrarPartida(partida(7, 'fa'));
  Api.registrarPartida(partida(9, 'do'));
  await esperar(500);
  ok('fila acumula as 3 partidas', Api.pendentes() === 3, `${Api.pendentes()} pendente(s)`);

  ok('recorde por clave e independente', Api.recordeLocal('fa') === 7 && Api.recordeLocal('do') === 9);

  // Volta a conexao.
  redeLigada = true;
  const sinc = await Api.sincronizar();
  ok('sincroniza ao voltar a rede', sinc.enviadas === 3, JSON.stringify(sinc));
  ok('fila zerada', Api.pendentes() === 0, `${Api.pendentes()} pendente(s)`);

  const est = await Api.estatisticas();
  ok('servidor recebeu as 5 partidas', est?.geral?.partidas === 5, JSON.stringify(est?.geral));
  ok('recorde subiu para 18 no servidor', est?.geral?.recorde === 18);
  ok('as 3 claves aparecem', est?.por_clave?.length === 3);
}

// ------------------------------------------------------ conta e migracao
console.log('\nCriacao de conta e migracao do historico');
{
  const email = `cliente-${randomUUID().slice(0, 8)}@exemplo.com`;

  const r = await Api.cadastrar({ email, senha: 'senhaBoa12345', nome: 'Responsavel Teste' });
  ok('cadastro pelo cliente funciona', r.ok === true, JSON.stringify(r));
  ok('guarda a conta localmente', Api.contaAtual()?.email === email);

  const est = await Api.estatisticas();
  ok(
    'historico anonimo migrou para a conta',
    est?.geral?.partidas === 5 && est?.geral?.recorde === 18,
    JSON.stringify(est?.geral)
  );

  const fraca = await Api.cadastrar({ email: `x-${randomUUID().slice(0, 6)}@e.com`, senha: '123', nome: 'X' });
  ok('rejeita senha fraca com mensagem', fraca.ok === false && !!fraca.erro, JSON.stringify(fraca));

  const rank = await Api.ranking('sol', 'semana');
  ok('ranking chega ao cliente', rank !== null && typeof rank.eu?.posicao === 'number',
     JSON.stringify(rank?.eu));

  await Api.sair();
  ok('sair limpa a conta local', Api.contaAtual() === null);
}

// --------------------------------------------------- partida implausivel
console.log('\nPartida implausivel nao entope a fila');
{
  // 500 pontos em 60s: o servidor recusa com 4xx. O cliente precisa DESCARTAR,
  // senao a fila tenta para sempre e nunca mais envia nada.
  Api.registrarPartida({
    clave: 'sol',
    pontuacao: 500,
    acertos: 500,
    erros: 0,
    nivel_max: 63,
    duracao_ms: 60000,
  });
  await esperar(1000);
  ok('partida recusada sai da fila', Api.pendentes() === 0, `${Api.pendentes()} pendente(s)`);

  Api.registrarPartida(partida(6));
  await esperar(1000);
  ok('fila volta a funcionar depois', Api.pendentes() === 0, `${Api.pendentes()} pendente(s)`);
}

// ------------------------------------------------- perfil e turmas
console.log('\nPerfil e turmas');
{
  // Renomear funciona tambem sem conta (identidade anonima do aparelho).
  const r = await Api.atualizarJogador({ apelido: 'Ana Clara' });
  ok('renomeia o perfil sem conta', r.ok === true && r.jogador?.apelido === 'Ana Clara',
     JSON.stringify(r));
  ok('cache local do perfil atualiza', Api.jogadorAtual()?.apelido === 'Ana Clara');

  const curto = await Api.atualizarJogador({ apelido: 'A' });
  ok('rejeita apelido de 1 letra', curto.ok === false, JSON.stringify(curto));

  const semConta = await Api.criarTurma('Turma sem conta');
  ok('anonimo NAO cria turma', semConta.ok === false, JSON.stringify(semConta));

  // Agora com conta.
  const email = `turma-${randomUUID().slice(0, 8)}@exemplo.com`;
  const cad = await Api.cadastrar({ email, senha: 'senhaBoa12345', nome: 'Professora Marta' });
  ok('cria a conta da professora', cad.ok === true, JSON.stringify(cad));

  // O perfil anterior ja pertence a outra conta (a do teste anterior), entao a
  // conta nova recebe um perfil proprio. Damos nome a ele.
  const ren = await Api.atualizarJogador({ apelido: 'Ana Clara' });
  ok('nomeia o perfil da conta nova', ren.ok === true, JSON.stringify(ren));

  const criada = await Api.criarTurma('Violino - Tarde');
  ok('conta cria turma', criada.ok === true, JSON.stringify(criada));
  ok('codigo da turma no formato certo',
     /^[A-HJ-NP-Z2-9]{6}$/.test(criada.turma?.codigo || ''), criada.turma?.codigo);

  const lista = await Api.minhasTurmas();
  ok('turma aparece em "administro"',
     lista?.administro?.some((t) => t.id === criada.turma.id) === true,
     JSON.stringify(lista?.administro));

  const entrou = await Api.entrarTurma(criada.turma.codigo);
  ok('entra na turma pelo codigo', entrou.ok === true, JSON.stringify(entrou));

  // O codigo e normalizado para maiusculas pelo cliente.
  const minusculo = await Api.entrarTurma(criada.turma.codigo.toLowerCase());
  ok('aceita codigo digitado em minusculas', minusculo.ok === true, JSON.stringify(minusculo));

  const ruim = await Api.entrarTurma('ZZZZZZ');
  ok('codigo inexistente recusado', ruim.ok === false, JSON.stringify(ruim));

  const rank = await Api.rankingTurma(criada.turma.id);
  ok('ranking da turma chega ao cliente', Array.isArray(rank?.ranking),
     JSON.stringify(rank)?.slice(0, 140));
  ok('meu perfil aparece no ranking da turma',
     rank?.ranking?.some((x) => x.apelido === 'Ana Clara') === true,
     JSON.stringify(rank?.ranking));
}

// ------------------------------------------------- ranking geral e denuncia
console.log('\nRanking geral e denuncia');
{
  // O perfil ativo aqui e o da conta criada na secao anterior, que ainda nao
  // jogou: posicao null e a resposta CORRETA nesse caso.
  const semJogar = await Api.ranking('sol', 'todos');
  ok('ranking responde mesmo sem eu ter jogado', semJogar !== null);
  ok('sem partida na clave, posicao vem null',
     semJogar?.eu?.posicao === null && semJogar?.eu?.minha_melhor === null,
     JSON.stringify(semJogar?.eu));

  // Agora joga e a posicao passa a existir.
  Api.registrarPartida({
    clave: 'sol', pontuacao: 7, acertos: 7, erros: 3, nivel_max: 1, duracao_ms: 60000,
  });
  await esperar(1200);

  const rank = await Api.ranking('sol', 'todos');
  ok('ranking geral chega ao cliente', rank !== null, String(rank));
  ok('tras o topo', Array.isArray(rank?.topo) && rank.topo.length > 0,
     JSON.stringify(rank?.topo)?.slice(0, 120));
  ok('depois de jogar, tras minha posicao', typeof rank?.eu?.posicao === 'number',
     JSON.stringify(rank?.eu));
  ok('minha melhor pontuacao bate', rank?.eu?.minha_melhor === 7, JSON.stringify(rank?.eu));
  ok('topo ordenado', rank.topo.every((x, i, a) => i === 0 || a[i - 1].melhor >= x.melhor));

  // Sem clave: agrega todas.
  const todas = await Api.ranking(null, 'todos');
  ok('funciona sem filtrar clave', todas !== null && todas.clave === 'todas',
     JSON.stringify(todas?.clave));

  // Denunciar exige um perfil de OUTRA pessoa; pegamos do proprio topo.
  const meu = rank.eu?.jogador_id;
  const outro = rank.topo.find((t) => t.jogador_id && t.jogador_id !== meu);
  if (outro) {
    const d = await Api.denunciar(outro.jogador_id);
    ok('denuncia pelo cliente funciona', d.ok === true, JSON.stringify(d));
    const rep = await Api.denunciar(outro.jogador_id);
    ok('denuncia repetida devolve jaDenunciado', rep.ok === true && rep.jaDenunciado === true,
       JSON.stringify(rep));
  } else {
    ok('havia outro jogador no topo para denunciar', false, 'topo sem terceiros');
  }

  if (meu) {
    const proprio = await Api.denunciar(meu);
    ok('nao denuncia o proprio perfil', proprio.ok === false, JSON.stringify(proprio));
  }
}

// ------------------------------------------------------- multiplos perfis
console.log('\nMultiplos perfis (uma familia, varias criancas)');
{
  const antes = await Api.listarJogadores();
  ok('lista os perfis da conta', Array.isArray(antes), JSON.stringify(antes)?.slice(0, 100));

  const novo = await Api.criarJogador('Bruninho');
  ok('cria um segundo perfil', novo.ok === true, JSON.stringify(novo));
  ok('o novo perfil passa a ser o ativo', Api.jogadorAtual()?.id === novo.jogador.id);

  const depois = await Api.listarJogadores();
  ok('lista cresceu', depois.length === antes.length + 1,
     `${antes.length} -> ${depois.length}`);

  const ofensivo = await Api.criarJogador('caralho');
  ok('perfil com apelido ofensivo e recusado', ofensivo.ok === false, JSON.stringify(ofensivo));

  // Troca de quem esta jogando e volta.
  const primeiro = depois[0];
  ok('seleciona outro perfil', Api.selecionarJogador(primeiro) === true);
  ok('perfil ativo mudou', Api.jogadorAtual()?.id === primeiro.id);

  // A partida vai para o perfil ativo, nao para o anterior.
  Api.registrarPartida({
    clave: 'fa', pontuacao: 5, acertos: 5, erros: 3, nivel_max: 1, duracao_ms: 45000,
  });
  await esperar(1200);
  ok('partida do perfil ativo sincroniza', Api.pendentes() === 0, `${Api.pendentes()} pendente(s)`);

  const est = await Api.estatisticas();
  ok('estatisticas seguem o perfil ativo', est?.jogador?.id === primeiro.id,
     JSON.stringify(est?.jogador));
}

// --------------------------------------------------- login obrigatorio
console.log('\nLogin obrigatorio (portao)');
{
  // Instancia nova = aparelho virgem, sem sessao herdada.
  const ApiG = criarApi({ exigirLogin: true });

  ok('detecta que o login e obrigatorio', ApiG.estado.exigeLogin === true);
  ok('comeca sem sessao', ApiG.temSessao() === false);

  const r1 = await ApiG.init();
  ok('init pede login', r1.precisaLogin === true, JSON.stringify(r1));

  // O ponto central: NAO deve existir identidade anonima de aparelho, senao o
  // portao teria como ser contornado.
  let erro = null;
  try {
    await ApiG.estatisticas();
  } catch (e) {
    erro = e.message;
  }
  ok('sem sessao nao ha credencial nenhuma', erro !== null, String(erro));

  const email = `portao-${randomUUID().slice(0, 8)}@exemplo.com`;
  const cad = await ApiG.cadastrar({
    email, senha: 'senhaBoa12345', nome: 'Responsavel do Portao',
  });
  ok('cadastro abre o portao', cad.ok === true, JSON.stringify(cad));
  ok('passa a ter sessao', ApiG.temSessao() === true);

  const r2 = await ApiG.init();
  ok('init libera depois do login', r2.precisaLogin === false, JSON.stringify(r2));

  ApiG.registrarPartida({
    clave: 'sol', pontuacao: 9, acertos: 9, erros: 3, nivel_max: 2, duracao_ms: 60000,
  });
  await esperar(1200);
  ok('joga e sincroniza normalmente', ApiG.pendentes() === 0, `${ApiG.pendentes()} pendente(s)`);

  // Distincao que importa: falta de REDE nao e sessao morta. Quem ja logou
  // continua jogando no aviao.
  redeLigada = false;
  const r3 = await ApiG.init();
  ok('sem rede, mas com sessao, NAO volta ao portao', r3.precisaLogin === false,
     JSON.stringify(r3));
  ok('marca que esta offline', r3.offline === true, JSON.stringify(r3));
  redeLigada = true;

  await ApiG.sair();
  ok('sair apaga a sessao', ApiG.temSessao() === false);
  const r4 = await ApiG.init();
  ok('depois de sair, pede login de novo', r4.precisaLogin === true, JSON.stringify(r4));

  // Sessao invalida (servidor recusa o refresh) tem de voltar ao portao.
  const ApiZ = criarApi({ exigirLogin: true });
  await ApiZ.entrar({ email, senha: 'senhaBoa12345' });
  ok('login direto funciona', ApiZ.temSessao() === true);
  await ApiZ.sair();
  const r5 = await ApiZ.init();
  ok('sessao revogada volta ao portao', r5.precisaLogin === true, JSON.stringify(r5));
}

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log('='.repeat(52));
process.exit(falhou > 0 ? 1 : 0);
