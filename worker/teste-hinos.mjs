/**
 * Testa os hinos e o painel do administrador contra o Worker local.
 *
 *   .dev.vars precisa de ADMIN_EMAILS=admin-teste@exemplo.com
 *   npm run worker:dev
 *   node worker/teste-hinos.mjs [http://localhost:8787]
 */
const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/+$/, '');
const ADMIN = 'admin-teste@exemplo.com';

let passou = 0;
let falhou = 0;
function ok(nome, cond, extra = '') {
  if (cond) passou++;
  else falhou++;
  console.log(`  ${cond ? '\x1b[32mPASSOU' : '\x1b[31mFALHOU'}\x1b[0m  ${nome}${!cond && extra ? ` -> ${extra}` : ''}`);
}

async function req(metodo, caminho, { corpo, token } = {}) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: {
      ...(corpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, dados: await r.json().catch(() => null) };
}

/** Cadastra (ou entra, se ja existir) e devolve o token. */
async function conta(email) {
  const cad = await req('POST', '/v1/auth/cadastro', {
    corpo: { email, senha: 'senhaSegura123', nome: 'Teste', responsavel_confirmado: true },
  });
  if (cad.status === 201) return cad.dados;
  return (await req('POST', '/v1/auth/entrar', { corpo: { email, senha: 'senhaSegura123' } })).dados;
}

console.log(`\nTestando hinos em ${BASE}\n`);

const adm = await conta(ADMIN);
const comum = await conta(`comum${Date.now()}@exemplo.com`);
const disp = (await req('POST', '/v1/auth/dispositivo/registrar', { corpo: { plataforma: 'web' } })).dados;

ok('login do admin traz admin=true', adm.conta?.admin === true, JSON.stringify(adm.conta));
ok('conta comum traz admin=false', comum.conta?.admin === false);
const eu = await req('GET', '/v1/eu', { token: adm.access_token });
ok('/eu do admin traz admin=true', eu.dados?.conta?.admin === true);

// Acesso negado
ok('conta comum nao ve /admin (404)', (await req('GET', '/v1/admin/hinos', { token: comum.access_token })).status === 404);
ok('aparelho anonimo nao ve /admin (403)', (await req('GET', '/v1/admin/hinos', { token: disp.access_token })).status === 403);
ok('sem token nao ve /admin (401)', (await req('GET', '/v1/admin/config')).status === 401);

// Configuracao
const cfg = await req('PATCH', '/v1/admin/config', { token: adm.access_token, corpo: { hinos_nivel_minimo: 4 } });
ok('admin define nivel minimo', cfg.status === 200 && cfg.dados.hinos_nivel_minimo === 4);
ok('nivel invalido recusado', (await req('PATCH', '/v1/admin/config', { token: adm.access_token, corpo: { hinos_nivel_minimo: 0 } })).status === 400);

// Cadastro
const numero = 9000 + Math.floor(Math.random() * 900);
const novo = await req('POST', '/v1/admin/hinos', {
  token: adm.access_token,
  corpo: {
    numero, nome: 'Hino de Teste', tom: 'Eb', armadura: -3, compasso: '3/4', andamento: 72,
    trecho_sol: 'E4 G4 B4 E5 D5', trecho_fa: 'E3 B2 E2',
  },
});
ok('admin cadastra hino', novo.status === 201, JSON.stringify(novo.dados));
const id = novo.dados?.hino?.id;
ok('hino volta com trechos por clave', novo.dados?.hino?.trechos?.sol === 'E4 G4 B4 E5 D5' && novo.dados.hino.trechos.do === null);
ok('numero repetido recusado (409)', (await req('POST', '/v1/admin/hinos', { token: adm.access_token, corpo: { numero, nome: 'X', tom: 'C', armadura: 0, compasso: '4/4', trecho_sol: 'C4 D4' } })).status === 409);
ok('trecho mal formatado recusado', (await req('POST', '/v1/admin/hinos', { token: adm.access_token, corpo: { numero: numero + 1, nome: 'X', tom: 'C', armadura: 0, compasso: '4/4', trecho_sol: 'do4 re4' } })).status === 400);
ok('hino sem nenhum trecho recusado', (await req('POST', '/v1/admin/hinos', { token: adm.access_token, corpo: { numero: numero + 1, nome: 'X', tom: 'C', armadura: 0, compasso: '4/4' } })).status === 400);
ok('compasso invalido recusado', (await req('POST', '/v1/admin/hinos', { token: adm.access_token, corpo: { numero: numero + 1, nome: 'X', tom: 'C', armadura: 0, compasso: '5/4', trecho_sol: 'C4 D4' } })).status === 400);
ok('conta comum nao cadastra', (await req('POST', '/v1/admin/hinos', { token: comum.access_token, corpo: { numero: numero + 2, nome: 'X', tom: 'C', armadura: 0, compasso: '4/4', trecho_sol: 'C4 D4' } })).status === 404);

// Jogo
let jogo = await req('GET', '/v1/hinos', { token: disp.access_token });
ok('jogo recebe nivel minimo', jogo.dados?.nivel_minimo === 4);
ok('jogo recebe o hino ativo', jogo.dados?.hinos?.some((h) => h.id === id && h.trechos.fa === 'E3 B2 E2'));

// Edicao
const ed = await req('PATCH', `/v1/admin/hinos/${id}`, { token: adm.access_token, corpo: { trecho_fa: '', trecho_do: 'G3 A3 B3', ativo: false } });
ok('PATCH apaga trecho com "" e inclui outro', ed.status === 200 && ed.dados.hino.trechos.fa === null && ed.dados.hino.trechos.do === 'G3 A3 B3', JSON.stringify(ed.dados));
ok('PATCH desativa', ed.dados?.hino?.ativo === false);
jogo = await req('GET', '/v1/hinos', { token: disp.access_token });
ok('hino inativo some do jogo', !jogo.dados.hinos.some((h) => h.id === id));
ok('admin ainda ve o inativo', (await req('GET', '/v1/admin/hinos', { token: adm.access_token })).dados.hinos.some((h) => h.id === id));
ok('PATCH que apagaria todos os trechos recusado', (await req('PATCH', `/v1/admin/hinos/${id}`, { token: adm.access_token, corpo: { trecho_sol: '', trecho_do: '' } })).status === 400);
ok('PATCH em hino inexistente = 404', (await req('PATCH', '/v1/admin/hinos/999999', { token: adm.access_token, corpo: { nome: 'X' } })).status === 404);

// Exclusao
ok('admin exclui', (await req('DELETE', `/v1/admin/hinos/${id}`, { token: adm.access_token })).status === 200);
ok('excluir de novo = 404', (await req('DELETE', `/v1/admin/hinos/${id}`, { token: adm.access_token })).status === 404);

// Devolve o nivel padrao para nao afetar outros testes.
await req('PATCH', '/v1/admin/config', { token: adm.access_token, corpo: { hinos_nivel_minimo: 3 } });

console.log(`\n  ${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
