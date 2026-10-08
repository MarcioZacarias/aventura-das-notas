# Versão online: Cloudflare Workers + D1

O Worker `aventura-das-notas` serve **o jogo e a API no mesmo endereço**:

- `https://aventura-das-notas.marcio-zacariass.workers.dev/` → jogo (pasta `www/`, gerada no build)
- `.../health` e `.../v1/*` → API (`worker/src`), com banco **D1** (SQLite gerenciado)

O **GitHub Pages não é afetado**: ele continua servindo os arquivos da raiz do
repositório, com `config.js` em `apiBase: ''` (modo offline). O build do
Cloudflare altera só a cópia em `www/`, que não vai para o git.

O backend Docker em `server/` continua existindo como alternativa (VPS). As
regras de apelido e de plausibilidade de partida são as mesmas: o Worker
importa `server/src/lib/apelido.js` e `server/src/lib/plausibilidade.js`.

---

## 1. Configuração única no painel do Cloudflare

**Workers & Pages → aventura-das-notas → Settings → Build**

| Campo | Valor |
|---|---|
| Branch de produção | `main` |
| Build command | *(vazio — o `wrangler.jsonc` já roda `npm run build:cloudflare`)* |
| Deploy command | `npx wrangler deploy && npx wrangler d1 migrations apply DB --remote` |
| Root directory | `/` |

**Settings → Variables and Secrets → Add → tipo *Secret***

- `JWT_SECRET` = um valor aleatório longo. Gere com:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
  Trocar esse valor depois desloga todo mundo.

**Domains → Worker URL → Production**: ligue o interruptor do `workers.dev`
(no print ele estava desligado; sem isso a URL não responde).

No primeiro deploy o wrangler **cria o banco D1** `aventura-das-notas` sozinho e
em seguida aplica as migrations de `worker/migrations/`. Nos deploys seguintes
ele só aplica as migrations novas.

> Se o build reclamar de permissão no D1, crie o banco à mão em
> **Storage & Databases → D1 → Create** com o nome `aventura-das-notas`, copie o
> *Database ID* e cole em `wrangler.jsonc` como `"database_id": "..."`.

## 2. Deploy pelo terminal (alternativa)

```bash
npx wrangler login
npx wrangler secret put JWT_SECRET
npm run worker:deploy
```

## 3. Rodar local

```bash
# uma vez: segredo de dev (o arquivo .dev.vars não vai para o git)
#   JWT_SECRET=<valor aleatorio de 32+ caracteres>
#   RATE_LIMIT_DESLIGADO=true      <- só local, para a suíte de testes
npm run worker:migrar:local
npm run worker:dev            # http://localhost:8787
npm run test:worker           # 150 testes (77 API + 73 cliente)
```

---

## Diferenças em relação ao servidor Postgres

| Item | Postgres (`server/`) | D1 (`worker/`) |
|---|---|---|
| Hash de senha | scrypt | PBKDF2-SHA256, 100.000 iterações (máximo do Workers) |
| Datas | `timestamptz` | texto ISO 8601 UTC (`2026-10-07T12:00:00.000Z`) |
| `evolucao_30_dias[].dia` | data | `"AAAA-MM-DD"` (UTC) |
| `media` nas estatísticas | texto (`"12.5"`) | número (`12.5`) |
| Rate limit de auth | 20 a cada 5 min | 10 por minuto |
| Rate limit de turma | 20 a cada 5 min | 5 por minuto |
| Rate limit de denúncia | 10 a cada 10 min | 2 por minuto |

Os limites mudaram de janela porque o Rate Limiting do Workers só aceita
períodos de 10 ou 60 segundos.

**Custo de CPU do login.** O hash de senha é a única operação pesada da API. No
plano gratuito do Workers o limite é de 10 ms de CPU por requisição. Se
cadastro ou login começarem a falhar com erro **1102** ("Worker exceeded CPU
time limit"), há duas saídas:

- assinar o **Workers Paid** (US$ 5/mês, até 30 s de CPU), que é o recomendado;
- baixar o custo com a var `PBKDF2_ITERACOES` no `wrangler.jsonc`. As senhas já
  gravadas continuam válidas, porque o custo fica salvo junto de cada hash.

---

## Painel do administrador e hinos

`https://aventura-das-notas.marcio-zacariass.workers.dev/admin.html`

Só entra quem tem o e-mail em `ADMIN_EMAILS` (`wrangler.jsonc`, separado por
vírgula). O servidor confere o e-mail a cada chamada, então tirar alguém da
lista vale na hora. Para quem não é administrador, as rotas `/v1/admin/*`
respondem 404.

No painel:

- **Nível mínimo:** a partir de qual nível da partida os trechos de hinos
  começam a aparecer (padrão 3).
- **Hinos:** número, nome, tom, compasso (com o tipo binário, ternário ou
  quaternário), andamento e um trecho por clave. Sol lê a voz de cima, Fá o
  baixo e Dó (viola) o tenor. As notas são digitadas como estão escritas
  (`mi4 fá4 sol4 sib4`), e o tom aplica a armadura sozinho.

Os hinos ficam **só no banco D1**, nunca no repositório. Cadastre apenas
conteúdo que você tem direito de usar.

Na partida, depois do nível mínimo, de vez em quando chega um trecho: as notas
vêm na ordem da melodia, com a armadura na pauta e o letreiro do hino. O ritmo
não conta, só a nota.

Teste local: `ADMIN_EMAILS=admin-teste@exemplo.com` no `.dev.vars` e
`node worker/teste-hinos.mjs`.

## Moderação (denúncias)

Não existe rota de moderação na API. A revisão é feita direto no banco:

```bash
# fila aberta, mais antigas primeiro
npx wrangler d1 execute DB --remote --command \
  "select id, jogador_id, apelido_no_momento, motivo, observacao, criado_em
   from denuncias where estado = 'aberta' order by criado_em"

# denúncia procedente: troca o apelido e fecha a denúncia
npx wrangler d1 execute DB --remote --command \
  "update jogadores set apelido = 'Jogador' where id = '<jogador_id>';
   update denuncias set estado = 'procedente', revisado_em = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where jogador_id = '<jogador_id>' and estado = 'aberta'"
```

O mesmo pode ser feito no painel: **Storage & Databases → D1 → aventura-das-notas → Console**.

## Backup

O D1 tem **Time Travel**: restaura o banco para qualquer minuto dos últimos 7 dias
(plano gratuito) ou 30 dias (plano pago).

```bash
npx wrangler d1 time-travel info DB
npx wrangler d1 export DB --remote --output backup.sql   # cópia completa
```
