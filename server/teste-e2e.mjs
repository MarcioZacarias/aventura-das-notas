/**
 * Teste end-to-end da API. Exercita o fluxo completo contra o servidor rodando.
 *
 *   docker compose up -d
 *   node server/teste-e2e.mjs [http://localhost:3000]
 *
 * Nao e framework de teste: e um script de fumaca, para conferir depois de
 * mexer no backend que nada obvio quebrou.
 */
import { randomUUID } from 'node:crypto';

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

async function req(metodo, caminho, { corpo, token } = {}) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let dados = null;
  try {
    dados = await r.json();
  } catch {
    /* resposta sem corpo */
  }
  return { status: r.status, dados };
}

/** Partida honesta: 8 pontos em 60s esta bem dentro do teto de plausibilidade. */
function partidaHonesta(jogadorId, clave = 'sol', pontuacao = 8) {
  return {
    jogador_id: jogadorId,
    cliente_partida_id: randomUUID(),
    clave,
    pontuacao,
    acertos: pontuacao,
    erros: 3,
    nivel_max: 1 + Math.floor(pontuacao / 8),
    duracao_ms: 60000,
  };
}

console.log(`\nTestando API em ${BASE}\n`);

// ---------------------------------------------------------------- saude
console.log('Saude');
{
  const r = await req('GET', '/health');
  ok('GET /health responde 200', r.status === 200, `status ${r.status}`);
  ok('health confirma o servico', r.dados?.servico === 'aventura-das-notas-api');
}

// ------------------------------------------------- jogo anonimo (sem cadastro)
console.log('\nJogo anonimo (crianca joga sem login)');
let disp, tokenDisp, jogadorAnon;
{
  const r = await req('POST', '/v1/auth/dispositivo/registrar', {
    corpo: { plataforma: 'android' },
  });
  disp = r.dados;
  tokenDisp = disp?.access_token;
  ok('registra aparelho', r.status === 200 && !!disp?.dispositivo_id, `status ${r.status}`);
  ok('devolve segredo do aparelho', typeof disp?.segredo === 'string' && disp.segredo.length > 20);

  const login = await req('POST', '/v1/auth/dispositivo/entrar', {
    corpo: { dispositivo_id: disp.dispositivo_id, segredo: disp.segredo },
  });
  ok('reentra com o segredo correto', login.status === 200 && !!login.dados?.access_token);

  const errado = await req('POST', '/v1/auth/dispositivo/entrar', {
    corpo: { dispositivo_id: disp.dispositivo_id, segredo: 'segredo-errado-aqui' },
  });
  ok('recusa segredo errado', errado.status === 401, `status ${errado.status}`);

  const semAuth = await req('GET', '/v1/jogadores');
  ok('exige credencial em /v1/jogadores', semAuth.status === 401, `status ${semAuth.status}`);

  const cria = await req('POST', '/v1/jogadores', {
    token: tokenDisp,
    corpo: { apelido: 'Ana', avatar: 'violino' },
  });
  jogadorAnon = cria.dados?.jogador;
  ok('cria jogador anonimo', cria.status === 201 && !!jogadorAnon?.id, `status ${cria.status}`);

  const curto = await req('POST', '/v1/jogadores', {
    token: tokenDisp,
    corpo: { apelido: 'A' },
  });
  ok('rejeita apelido curto', curto.status === 400, `status ${curto.status}`);
}

// -------------------------------------------------------------- partidas
console.log('\nPartidas e anti-fraude');
let idPartidaRepetida;
{
  const p = partidaHonesta(jogadorAnon.id);
  idPartidaRepetida = p.cliente_partida_id;

  const r = await req('POST', '/v1/partidas', { token: tokenDisp, corpo: p });
  ok('aceita partida honesta', r.status === 201, `status ${r.status} ${JSON.stringify(r.dados)}`);
  ok('marca novo recorde', r.dados?.novo_recorde === true);

  const repetida = await req('POST', '/v1/partidas', {
    token: tokenDisp,
    corpo: { ...p, cliente_partida_id: idPartidaRepetida },
  });
  ok(
    'reenvio da mesma partida e idempotente',
    repetida.status === 200 && repetida.dados?.duplicada === true,
    `status ${repetida.status}`
  );

  const fraudeGrosseira = await req('POST', '/v1/partidas', {
    token: tokenDisp,
    corpo: {
      ...partidaHonesta(jogadorAnon.id),
      pontuacao: 999999,
      acertos: 999999,
      nivel_max: 9999,
    },
  });
  // 999999 estoura o `maximum` do schema, entao para no 400 antes de chegar a
  // checagem de plausibilidade. Sao duas barreiras em serie: schema (400) para
  // valores absurdos, plausibilidade (422) para fraude dentro dos limites.
  ok(
    'rejeita 999999 pontos na validacao de schema',
    fraudeGrosseira.status === 400,
    `status ${fraudeGrosseira.status}`
  );

  const fraudeSutil = await req('POST', '/v1/partidas', {
    token: tokenDisp,
    corpo: { ...partidaHonesta(jogadorAnon.id, 'sol', 60), erros: 0 },
  });
  ok('rejeita 60 pontos em 60s', fraudeSutil.status === 422, `status ${fraudeSutil.status}`);

  const errosDemais = await req('POST', '/v1/partidas', {
    token: tokenDisp,
    corpo: { ...partidaHonesta(jogadorAnon.id), erros: 12 },
  });
  ok('rejeita mais de 3 erros', errosDemais.status === 422, `status ${errosDemais.status}`);

  const jogadorAlheio = await req('POST', '/v1/partidas', {
    token: tokenDisp,
    corpo: partidaHonesta(randomUUID()),
  });
  ok(
    'nao aceita partida para jogador de outra pessoa',
    jogadorAlheio.status === 404,
    `status ${jogadorAlheio.status}`
  );

  // Mais algumas partidas para dar corpo as estatisticas.
  for (const [clave, pts] of [['sol', 15], ['fa', 6], ['do', 11]]) {
    await req('POST', '/v1/partidas', {
      token: tokenDisp,
      corpo: partidaHonesta(jogadorAnon.id, clave, pts),
    });
  }

  const est = await req('GET', `/v1/jogadores/${jogadorAnon.id}/estatisticas`, {
    token: tokenDisp,
  });
  ok('estatisticas retornam', est.status === 200, `status ${est.status}`);
  ok('recorde geral correto (15)', est.dados?.geral?.recorde === 15, JSON.stringify(est.dados?.geral));
  ok('agrupa pelas 3 claves', est.dados?.por_clave?.length === 3);
  ok('calcula precisao', typeof est.dados?.geral?.precisao_pct === 'number');

  const hist = await req('GET', `/v1/jogadores/${jogadorAnon.id}/partidas?limite=10`, {
    token: tokenDisp,
  });
  ok('historico lista partidas', hist.status === 200 && hist.dados?.partidas?.length === 4,
     `${hist.dados?.partidas?.length} partidas`);
}

// ------------------------------------------------------------ conta adulto
console.log('\nConta do responsavel');
const email = `teste-${randomUUID().slice(0, 8)}@exemplo.com`;
const SENHA = 'umaSenhaBoa123';
let tokenConta, refreshConta;
{
  const semConfirmacao = await req('POST', '/v1/auth/cadastro', {
    corpo: { email, senha: SENHA, nome: 'Marcio', responsavel_confirmado: false },
  });
  ok(
    'exige confirmacao de responsavel (LGPD Art. 14)',
    semConfirmacao.status === 400,
    `status ${semConfirmacao.status}`
  );

  const senhaFraca = await req('POST', '/v1/auth/cadastro', {
    corpo: { email, senha: '123', nome: 'Marcio', responsavel_confirmado: true },
  });
  ok('rejeita senha fraca', senhaFraca.status === 400, `status ${senhaFraca.status}`);

  const r = await req('POST', '/v1/auth/cadastro', {
    corpo: { email, senha: SENHA, nome: 'Marcio', responsavel_confirmado: true },
  });
  tokenConta = r.dados?.access_token;
  refreshConta = r.dados?.refresh_token;
  ok('cria conta', r.status === 201 && !!tokenConta, `status ${r.status} ${JSON.stringify(r.dados)}`);

  const duplicado = await req('POST', '/v1/auth/cadastro', {
    corpo: { email, senha: SENHA, nome: 'Outro', responsavel_confirmado: true },
  });
  ok('recusa e-mail duplicado com 409', duplicado.status === 409, `status ${duplicado.status}`);

  const login = await req('POST', '/v1/auth/entrar', { corpo: { email, senha: SENHA } });
  ok('login funciona', login.status === 200 && !!login.dados?.access_token);

  const senhaErrada = await req('POST', '/v1/auth/entrar', {
    corpo: { email, senha: 'senhaErrada999' },
  });
  ok('recusa senha errada', senhaErrada.status === 401, `status ${senhaErrada.status}`);

  const inexistente = await req('POST', '/v1/auth/entrar', {
    corpo: { email: 'ninguem@exemplo.com', senha: SENHA },
  });
  ok(
    'nao revela se o e-mail existe (mesma mensagem)',
    inexistente.status === 401 && inexistente.dados?.erro === senhaErrada.dados?.erro
  );

  const renovar = await req('POST', '/v1/auth/renovar', {
    corpo: { refresh_token: refreshConta },
  });
  ok('renova a sessao', renovar.status === 200 && !!renovar.dados?.access_token);
  ok('rotaciona o refresh token', renovar.dados?.refresh_token !== refreshConta);

  const reuso = await req('POST', '/v1/auth/renovar', {
    corpo: { refresh_token: refreshConta },
  });
  ok('refresh antigo nao serve mais', reuso.status === 401, `status ${reuso.status}`);

  refreshConta = renovar.dados.refresh_token;
  tokenConta = renovar.dados.access_token;

  const eu = await req('GET', '/v1/eu', { token: tokenConta });
  ok('GET /v1/eu identifica a conta', eu.status === 200 && eu.dados?.tipo === 'conta');
}

// ----------------------------------------------------- adocao do perfil
console.log('\nAdocao do perfil anonimo pela conta');
{
  const r = await req('POST', '/v1/jogadores/vincular', {
    token: tokenConta,
    corpo: { dispositivo_id: disp.dispositivo_id, segredo: disp.segredo },
  });
  ok('vincula jogadores do aparelho a conta', r.status === 200 && r.dados?.vinculados >= 1,
     `status ${r.status} ${JSON.stringify(r.dados)}`);

  const eu = await req('GET', '/v1/eu', { token: tokenConta });
  ok('jogador aparece na conta', eu.dados?.jogadores?.some((j) => j.id === jogadorAnon.id));

  const est = await req('GET', `/v1/jogadores/${jogadorAnon.id}/estatisticas`, {
    token: tokenConta,
  });
  ok('historico veio junto na adocao', est.status === 200 && est.dados?.geral?.recorde === 15);

  const segredoErrado = await req('POST', '/v1/jogadores/vincular', {
    token: tokenConta,
    corpo: { dispositivo_id: disp.dispositivo_id, segredo: 'errado-errado-errado' },
  });
  ok('adocao exige o segredo do aparelho', segredoErrado.status === 401);
}

// ------------------------------------------------------------------ turmas
console.log('\nTurmas (o lugar do "amigos")');
let turma, jogadorColega, tokenColega;
{
  const r = await req('POST', '/v1/turmas', {
    token: tokenConta,
    corpo: { nome: 'Violino - Turma da Tarde' },
  });
  turma = r.dados?.turma;
  ok('cria turma', r.status === 201 && !!turma?.id, `status ${r.status}`);
  ok(
    'codigo com 6 caracteres sem ambiguidade',
    /^[A-HJ-NP-Z2-9]{6}$/.test(turma?.codigo || ''),
    turma?.codigo
  );

  // Outro aparelho, simulando um colega de turma.
  const outro = await req('POST', '/v1/auth/dispositivo/registrar', { corpo: { plataforma: 'ios' } });
  tokenColega = outro.dados.access_token;
  const cria = await req('POST', '/v1/jogadores', {
    token: tokenColega,
    corpo: { apelido: 'Bruno', avatar: 'estrela' },
  });
  jogadorColega = cria.dados.jogador;

  await req('POST', '/v1/partidas', {
    token: tokenColega,
    corpo: partidaHonesta(jogadorColega.id, 'sol', 20),
  });

  const codigoErrado = await req('POST', '/v1/turmas/entrar', {
    token: tokenColega,
    corpo: { codigo: 'ZZZZZZ', jogador_id: jogadorColega.id },
  });
  ok('codigo invalido nao entra', codigoErrado.status === 404, `status ${codigoErrado.status}`);

  const entra = await req('POST', '/v1/turmas/entrar', {
    token: tokenColega,
    corpo: { codigo: turma.codigo, jogador_id: jogadorColega.id },
  });
  ok('entra na turma com o codigo', entra.status === 200, `status ${entra.status}`);

  // Asserido de proposito: antes este resultado era ignorado, e uma falha aqui
  // aparecia so depois, como "o ranking tem 1 jogador em vez de 2".
  const entraAna = await req('POST', '/v1/turmas/entrar', {
    token: tokenConta,
    corpo: { codigo: turma.codigo, jogador_id: jogadorAnon.id },
  });
  ok('Ana tambem entra na turma', entraAna.status === 200,
     `status ${entraAna.status} ${JSON.stringify(entraAna.dados)}`);

  const rank = await req('GET', `/v1/turmas/${turma.id}/ranking`, { token: tokenConta });
  ok('ranking da turma responde', rank.status === 200, `status ${rank.status}`);
  ok('ranking tem os 2 jogadores', rank.dados?.ranking?.length === 2,
     JSON.stringify(rank.dados?.ranking));
  ok(
    'ordenado por melhor pontuacao (Bruno 20 na frente de Ana 15)',
    rank.dados?.ranking?.[0]?.apelido === 'Bruno'
  );
  ok('ranking de turma MOSTRA apelidos (grupo fechado)',
     typeof rank.dados?.ranking?.[0]?.apelido === 'string');

  // Um terceiro, sem nenhum jogador na turma, nao deve conseguir olhar.
  const estranho = await req('POST', '/v1/auth/dispositivo/registrar', { corpo: {} });
  const espiando = await req('GET', `/v1/turmas/${turma.id}/ranking`, {
    token: estranho.dados.access_token,
  });
  ok('estranho nao ve ranking da turma', espiando.status === 404, `status ${espiando.status}`);
}

// ------------------------------------------------------------ ranking geral
console.log('\nRanking geral');
{
  const g = await req('GET', `/v1/ranking?clave=sol&periodo=semana&jogador_id=${jogadorAnon.id}`, {
    token: tokenConta,
  });
  ok('ranking geral responde', g.status === 200, `status ${g.status}`);
  ok('traz distribuicao', typeof g.dados?.distribuicao?.total_jogadores === 'number');
  ok('traz minha posicao', typeof g.dados?.eu?.posicao === 'number', JSON.stringify(g.dados?.eu));
  ok('traz percentil', typeof g.dados?.eu?.percentil === 'number');
  ok('traz o jogador_id em "eu"', g.dados?.eu?.jogador_id === jogadorAnon.id);

  ok('traz a lista do topo', Array.isArray(g.dados?.topo) && g.dados.topo.length > 0,
     JSON.stringify(g.dados?.topo)?.slice(0, 120));
  ok('declara se mostra apelidos', typeof g.dados?.mostra_apelidos === 'boolean');
  ok('topo tras apelido (nomes habilitados)',
     g.dados.mostra_apelidos ? typeof g.dados.topo[0].apelido === 'string' : true,
     JSON.stringify(g.dados.topo[0]));
  ok('topo comeca pela maior pontuacao',
     g.dados.topo[0].melhor === g.dados.distribuicao.melhor_geral,
     `topo=${g.dados.topo[0].melhor} max=${g.dados.distribuicao.melhor_geral}`);
  ok('topo ordenado do maior para o menor',
     g.dados.topo.every((x, i, a) => i === 0 || a[i - 1].melhor >= x.melhor));
  ok('posicoes sequenciais a partir de 1',
     g.dados.topo.every((x, i) => x.posicao === i + 1));
  ok('topo respeita o limite configurado', g.dados.topo.length <= 50);

  const semJogador = await req('GET', '/v1/ranking?periodo=todos', { token: tokenConta });
  ok('funciona sem jogador_id', semJogador.status === 200 && semJogador.dados?.eu === null,
     `status ${semJogador.status}`);

  const semAuth = await req('GET', '/v1/ranking');
  ok('ranking exige credencial', semAuth.status === 401, `status ${semAuth.status}`);
}

// -------------------------------------------------- moderacao de apelido
console.log('\nModeracao de apelido (o apelido aparece no ranking publico)');
{
  const casos = [
    ['ofensivo direto', 'caralho'],
    ['separado por espaco', 'p u t a'],
    ['com repeticao', 'caaaralho'],
    ['reservado', 'admin'],
    ['com emoji', 'Ana \u{1F3BB}'],
    ['com markup', '<b>Ana</b>'],
    ['invisivel no meio', 'Ana\u200bClara'],
  ];
  for (const [rotulo, apelido] of casos) {
    const r = await req('POST', '/v1/jogadores', { token: tokenDisp, corpo: { apelido } });
    ok(`recusa apelido ${rotulo}`, r.status === 400, `status ${r.status} para ${JSON.stringify(apelido)}`);
  }

  const bom = await req('POST', '/v1/jogadores', {
    token: tokenDisp,
    corpo: { apelido: 'Carlos Eduardo' },
  });
  ok('aceita apelido normal com espaco', bom.status === 201, `status ${bom.status}`);
  ok('aceita acento', (await req('POST', '/v1/jogadores', {
    token: tokenDisp, corpo: { apelido: 'Zé' },
  })).status === 201);

  const patch = await req('PATCH', `/v1/jogadores/${bom.dados.jogador.id}`, {
    token: tokenDisp,
    corpo: { apelido: 'merda' },
  });
  ok('PATCH tambem passa pelo filtro', patch.status === 400, `status ${patch.status}`);
}

// ------------------------------------------------------------- denuncias
console.log('\nDenuncias (a outra metade da moderacao)');
{
  const d = await req('POST', '/v1/denuncias', {
    token: tokenColega,
    corpo: { jogador_id: jogadorAnon.id, motivo: 'apelido_ofensivo' },
  });
  ok('registra a denuncia', d.status === 200 && d.dados?.ok === true, JSON.stringify(d.dados));
  ok('primeira denuncia nao e duplicada', d.dados?.ja_denunciado === false);

  const rep = await req('POST', '/v1/denuncias', {
    token: tokenColega,
    corpo: { jogador_id: jogadorAnon.id, motivo: 'apelido_ofensivo' },
  });
  ok('denuncia repetida nao infla a fila',
     rep.status === 200 && rep.dados?.ja_denunciado === true, JSON.stringify(rep.dados));

  const proprio = await req('POST', '/v1/denuncias', {
    token: tokenColega,
    corpo: { jogador_id: jogadorColega.id, motivo: 'apelido_ofensivo' },
  });
  ok('nao permite denunciar o proprio perfil', proprio.status === 400, `status ${proprio.status}`);

  const fantasma = await req('POST', '/v1/denuncias', {
    token: tokenColega,
    corpo: { jogador_id: randomUUID(), motivo: 'apelido_ofensivo' },
  });
  ok('alvo inexistente devolve 404', fantasma.status === 404, `status ${fantasma.status}`);

  const semAuth = await req('POST', '/v1/denuncias', {
    corpo: { jogador_id: jogadorAnon.id, motivo: 'apelido_ofensivo' },
  });
  ok('denuncia exige credencial', semAuth.status === 401, `status ${semAuth.status}`);

  const motivoInvalido = await req('POST', '/v1/denuncias', {
    token: tokenColega,
    corpo: { jogador_id: jogadorAnon.id, motivo: 'qualquer_coisa' },
  });
  ok('motivo fora da lista e recusado', motivoInvalido.status === 400,
     `status ${motivoInvalido.status}`);
}

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${passou} passaram, ${falhou} falharam`);
console.log('='.repeat(52));
process.exit(falhou > 0 ? 1 : 0);
