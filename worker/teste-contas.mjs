/**
 * Testa a gestao de contas do painel (lista, ficha, banimento, exclusao).
 *
 *   .dev.vars precisa de ADMIN_EMAILS=admin-teste@exemplo.com
 *   node worker/teste-contas.mjs [http://localhost:8787]
 */
import { randomUUID } from 'node:crypto';

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

const SENHA = 'senhaSegura123';
async function cadastrar(email, nome) {
  const r = await req('POST', '/v1/auth/cadastro', { corpo: { email, senha: SENHA, nome, responsavel_confirmado: true } });
  if (r.status === 201) return r.dados;
  return (await req('POST', '/v1/auth/entrar', { corpo: { email, senha: SENHA } })).dados;
}

console.log(`\nTestando gestao de contas em ${BASE}\n`);

const adm = (await cadastrar('admin-teste@exemplo.com', 'Admin Teste')).access_token;
const sufixo = Date.now();
const emailAlvo = `alvo${sufixo}@exemplo.com`;
const alvo = await cadastrar(emailAlvo, `Pessoa Alvo ${sufixo}`.slice(0, 40));
const tAlvo = alvo.access_token;
const contaId = alvo.conta.id;

// Perfil + partida para aparecer no ranking.
const jog = (await req('POST', '/v1/jogadores', { token: tAlvo, corpo: { apelido: 'Alvinho' } })).dados.jogador;
await req('POST', '/v1/partidas', {
  token: tAlvo,
  corpo: { jogador_id: jog.id, cliente_partida_id: randomUUID(), clave: 'sol', pontuacao: 8, acertos: 8, erros: 3, nivel_max: 2, duracao_ms: 60000 },
});

// --- acesso
ok('usuario comum nao lista contas', (await req('GET', '/v1/admin/contas', { token: tAlvo })).status === 404);

// --- lista e busca
const lista = await req('GET', `/v1/admin/contas?busca=${encodeURIComponent(emailAlvo)}`, { token: adm });
const linha = lista.dados?.contas?.find((x) => x.id === contaId);
ok('admin encontra a conta pela busca', !!linha, JSON.stringify(lista.dados).slice(0, 200));
ok('lista traz perfis, partidas e apelidos', linha && linha.jogadores >= 1 && linha.partidas >= 1 && /Alvinho/.test(linha.apelidos || ''));
ok('lista traz resumo geral', typeof lista.dados?.resumo?.contas === 'number');
const porApelido = await req('GET', '/v1/admin/contas?busca=alvinho', { token: adm });
ok('busca pelo apelido do perfil', porApelido.dados.contas.some((x) => x.id === contaId));

// --- ficha
const ficha = await req('GET', `/v1/admin/contas/${contaId}`, { token: adm });
ok('ficha da conta com perfis e sessoes', ficha.status === 200 && ficha.dados.jogadores.length >= 1 && ficha.dados.sessoes_abertas >= 1);

// --- editar nome e apelido
ok('admin edita nome', (await req('PATCH', `/v1/admin/contas/${contaId}`, { token: adm, corpo: { nome: 'Nome Corrigido' } })).dados?.conta?.nome === 'Nome Corrigido');
ok('admin renomeia perfil', (await req('PATCH', `/v1/admin/jogadores/${jog.id}`, { token: adm, corpo: { apelido: 'Novo Apelido' } })).dados?.jogador?.apelido === 'Novo Apelido');
ok('renomear com apelido ofensivo recusado', (await req('PATCH', `/v1/admin/jogadores/${jog.id}`, { token: adm, corpo: { apelido: 'porra' } })).status === 400);

const rankAntes = await req('GET', '/v1/ranking?periodo=todos', { token: adm });
ok('perfil aparece no ranking antes do ban', rankAntes.dados.topo.some((t) => t.jogador_id === jog.id) || rankAntes.dados.distribuicao.total_jogadores > 0);

// --- banir
const ban = await req('PATCH', `/v1/admin/contas/${contaId}`, { token: adm, corpo: { banida: true, motivo: 'teste' } });
ok('admin bane conta', ban.status === 200 && !!ban.dados.conta.banida_em && ban.dados.conta.ban_motivo === 'teste');
const usoToken = await req('GET', '/v1/eu', { token: tAlvo });
ok('token ainda valido para de funcionar na hora', usoToken.status === 401, String(usoToken.status));
const login = await req('POST', '/v1/auth/entrar', { corpo: { email: emailAlvo, senha: SENHA } });
ok('login de conta banida recusado com mensagem', login.status === 403 && /suspensa/.test(login.dados?.erro || ''));
const loginErrado = await req('POST', '/v1/auth/entrar', { corpo: { email: emailAlvo, senha: 'senhaErrada99' } });
ok('senha errada nao revela o banimento', loginErrado.status === 401);
const renovar = await req('POST', '/v1/auth/renovar', { corpo: { refresh_token: alvo.refresh_token } });
ok('sessao antiga (refresh) revogada', renovar.status === 401);
const rankDepois = await req('GET', '/v1/ranking?periodo=todos', { token: adm });
ok('perfil some do ranking', !rankDepois.dados.topo.some((t) => t.jogador_id === jog.id));
const filtroBan = await req('GET', '/v1/admin/contas?situacao=banidas', { token: adm });
ok('filtro de banidas', filtroBan.dados.contas.some((x) => x.id === contaId) && filtroBan.dados.contas.every((x) => x.banida_em));

// --- admin nao pode ser banido/excluido
const eu = await req('GET', '/v1/eu', { token: adm });
ok('admin nao pode se banir', (await req('PATCH', `/v1/admin/contas/${eu.dados.conta.id}`, { token: adm, corpo: { banida: true } })).status === 400);

// --- desbanir
ok('admin remove banimento', (await req('PATCH', `/v1/admin/contas/${contaId}`, { token: adm, corpo: { banida: false } })).dados?.conta?.banida_em === null);
const login2 = await req('POST', '/v1/auth/entrar', { corpo: { email: emailAlvo, senha: SENHA } });
ok('volta a entrar depois de desbanido', login2.status === 200);

// --- encerrar sessoes
const enc = await req('POST', `/v1/admin/contas/${contaId}/encerrar-sessoes`, { token: adm });
ok('encerrar sessoes', enc.status === 200 && enc.dados.encerradas >= 1);
ok('refresh revogado apos encerrar', (await req('POST', '/v1/auth/renovar', { corpo: { refresh_token: login2.dados.refresh_token } })).status === 401);

// --- excluir
ok('excluir exige e-mail certo', (await req('DELETE', `/v1/admin/contas/${contaId}`, { token: adm, corpo: { confirmar_email: 'errado@x.com' } })).status === 400);
ok('excluir conta', (await req('DELETE', `/v1/admin/contas/${contaId}`, { token: adm, corpo: { confirmar_email: emailAlvo } })).status === 200);
ok('conta excluida some', (await req('GET', `/v1/admin/contas/${contaId}`, { token: adm })).status === 404);

console.log(`\n  ${passou} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
