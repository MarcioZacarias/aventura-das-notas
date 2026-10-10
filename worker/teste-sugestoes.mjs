/**
 * Testa as sugestoes contra o Worker local.
 *
 *   .dev.vars precisa de ADMIN_EMAILS=admin-teste@exemplo.com
 *   node worker/teste-sugestoes.mjs [http://localhost:8787]
 */
const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/+$/, '');

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

async function conta(email) {
  const corpo = { email, senha: 'senhaSegura123', nome: 'Teste', responsavel_confirmado: true };
  const cad = await req('POST', '/v1/auth/cadastro', { corpo });
  if (cad.status === 201) return cad.dados.access_token;
  return (await req('POST', '/v1/auth/entrar', { corpo: { email, senha: corpo.senha } })).dados.access_token;
}

console.log(`\nTestando sugestoes em ${BASE}\n`);

const adm = await conta('admin-teste@exemplo.com');
const ana = await conta(`ana${Date.now()}@exemplo.com`);
const beto = await conta(`beto${Date.now()}@exemplo.com`);
const disp = (await req('POST', '/v1/auth/dispositivo/registrar', { corpo: { plataforma: 'web' } })).dados.access_token;

const s1 = await req('POST', '/v1/sugestoes', { token: ana, corpo: { texto: 'Colocar mais hinos na clave de Fá', apelido: 'Aninha' } });
ok('usuario envia sugestao', s1.status === 201 && s1.dados.sugestao.estado === 'recebida', JSON.stringify(s1.dados));
const id = s1.dados?.sugestao?.id;
ok('texto curto recusado', (await req('POST', '/v1/sugestoes', { token: ana, corpo: { texto: 'oi' } })).status === 400);
ok('sem login recusado', (await req('POST', '/v1/sugestoes', { corpo: { texto: 'Uma ideia qualquer' } })).status === 401);
ok('aparelho anonimo tambem envia', (await req('POST', '/v1/sugestoes', { token: disp, corpo: { texto: 'Modo noturno no jogo' } })).status === 201);

const minhasAna = await req('GET', '/v1/sugestoes', { token: ana });
ok('autor ve a propria sugestao', minhasAna.dados.sugestoes.some((s) => s.id === id));
const minhasBeto = await req('GET', '/v1/sugestoes', { token: beto });
ok('outro usuario NAO ve a sugestao', !minhasBeto.dados.sugestoes.some((s) => s.id === id));

ok('usuario comum nao acessa a lista do admin', (await req('GET', '/v1/admin/sugestoes', { token: ana })).status === 404);
const lista = await req('GET', '/v1/admin/sugestoes', { token: adm });
const noAdmin = lista.dados?.sugestoes?.find((s) => s.id === id);
ok('admin ve a sugestao com autor e apelido', noAdmin && noAdmin.apelido === 'Aninha' && noAdmin.autor_nome === 'Teste', JSON.stringify(noAdmin));
ok('usuario comum nao muda estado', (await req('PATCH', `/v1/admin/sugestoes/${id}`, { token: ana, corpo: { estado: 'implementada' } })).status === 404);

const impl = await req('PATCH', `/v1/admin/sugestoes/${id}`, { token: adm, corpo: { estado: 'implementada', resposta: 'Feito na versão de outubro!' } });
ok('admin marca como implementada', impl.status === 200 && impl.dados.sugestao.estado === 'implementada');

let agora = (await req('GET', '/v1/sugestoes', { token: ana })).dados.sugestoes.find((s) => s.id === id);
ok('autor recebe a novidade (autor_viu=false) e a resposta', agora.autor_viu === false && agora.resposta === 'Feito na versão de outubro!');
ok('marcar como vistas', (await req('POST', '/v1/sugestoes/vistas', { token: ana })).status === 200);
agora = (await req('GET', '/v1/sugestoes', { token: ana })).dados.sugestoes.find((s) => s.id === id);
ok('depois de visto, nao avisa de novo', agora.autor_viu === true);

const filtro = await req('GET', '/v1/admin/sugestoes?estado=implementada', { token: adm });
ok('filtro por estado no admin', filtro.dados.sugestoes.every((s) => s.estado === 'implementada'));
ok('estado invalido recusado', (await req('PATCH', `/v1/admin/sugestoes/${id}`, { token: adm, corpo: { estado: 'feita' } })).status === 400);

console.log(`\n  ${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
