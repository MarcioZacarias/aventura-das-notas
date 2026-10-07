# Subir o backend no seu próprio servidor

O backend é um `docker compose` com dois containers: **Postgres** e a **API** (Fastify).
Em produção entra um terceiro, o **Caddy**, que resolve HTTPS automaticamente.

Consumo: roda folgado em VPS de 1 vCPU / 2 GB.

---

## 1. Rodar local (já funciona, sem servidor nenhum)

```bash
cp .env.example .env
# gere os segredos:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# cole em POSTGRES_PASSWORD e JWT_SECRET

npm run server:up      # sobe banco + API, aplica as migrations
npm test               # 149 testes (76 na API, 73 no cliente)
```

A API sobe em `http://localhost:3000`. Confira: `curl http://localhost:3000/health`

| Comando | O que faz |
|---|---|
| `npm run server:up` | sobe/reconstrói os containers |
| `npm run server:logs` | acompanha o log da API |
| `npm run server:down` | para (os dados **persistem** no volume) |
| `npm run server:reset` | para e **APAGA o banco** |

---

## 2. Escolher o servidor

Qualquer VPS com Docker serve. Referência de preço e capacidade:

| Provedor | Plano | Preço aprox. | Observação |
|---|---|---|---|
| Hetzner | CX22 (2 vCPU, 4 GB) | ~€4/mês | melhor custo-benefício; datacenter na Europa (latência ~200ms do Brasil) |
| Contabo | VPS S | ~€5/mês | recursos generosos, desempenho irregular |
| DigitalOcean | Basic 1 GB | ~US$6/mês | tem região em São Paulo — melhor latência para o Brasil |
| Oracle Cloud | Ampere free tier | grátis | 4 vCPU ARM / 24 GB; disponibilidade instável, mas gratuito de verdade |
| Magalu Cloud / Locaweb | — | varia | dados no Brasil, o que simplifica o discurso de LGPD |

Para um jogo educativo com usuários no Brasil, **DigitalOcean São Paulo** ou um provedor
nacional dão a melhor experiência. Latência importa pouco aqui (o jogo é offline-first e só
sincroniza depois da partida), então o critério pode ser preço.

Também precisa de um **domínio** (~R$40/ano num `.com.br` pelo registro.br). Aponte um
registro A de `api.seudominio.com.br` para o IP do servidor.

---

## 3. Preparar o servidor

```bash
ssh root@SEU_IP

# Docker (script oficial)
curl -fsSL https://get.docker.com | sh

# Usuário sem root para a aplicação
adduser --disabled-password --gecos "" aventura
usermod -aG docker aventura

# Firewall: só SSH e HTTP/HTTPS. O Postgres NUNCA fica exposto.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

---

## 4. Instalar a aplicação

```bash
su - aventura
git clone https://github.com/MarcioZacarias/aventura-das-notas.git /opt/aventura-das-notas
cd /opt/aventura-das-notas

cp .env.example .env
nano .env
```

No `.env` do **servidor**, três ajustes são obrigatórios:

```ini
POSTGRES_PASSWORD=<gere um aleatorio longo>
JWT_SECRET=<gere outro aleatorio longo>

# A API deixa de ser acessível de fora: só o Caddy fala com ela.
API_BIND=127.0.0.1

DOMINIO_API=api.seudominio.com.br

# Origens que o app usa. NÃO deixe "*" em produção.
CORS_ORIGINS=https://localhost,capacitor://localhost
```

> `https://localhost` é a origem do WebView no Android; `capacitor://localhost` no iOS.
> Se for servir o jogo também na web, acrescente o domínio do site.

Suba com o overlay de produção:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d
docker compose logs -f caddy   # acompanhe a emissão do certificado
```

O Caddy obtém o certificado Let's Encrypt sozinho na primeira subida, e renova sem cron.
Teste: `curl https://api.seudominio.com.br/health`

---

## 5. Apontar o app para o servidor

```bash
API_BASE=https://api.seudominio.com.br npm run apk    # ou npm run aab
```

A variável `API_BASE` faz duas coisas no build: grava o `apiBase` no `config.js` dentro de
`www/` (o arquivo da raiz fica intacto) e libera **exatamente** essa origem no `connect-src`
da CSP.

Com login obrigatório (o padrão), o build **falha** sem `API_BASE` — de propósito: sem servidor
o portão de login nem carrega, e o app abriria liberado. Para um build sem login, use
`EXIGIR_LOGIN=0` (ver seção 11).

Confirme no build:

```
Modo ONLINE  -> API em https://api.seudominio.com.br (liberada no connect-src)
```

---

## 6. Backup

Sem isto, um disco perdido apaga o histórico de todos os alunos.

```bash
crontab -e
# 0 3 * * * /opt/aventura-das-notas/deploy/backup.sh >> /var/log/aventura-backup.log 2>&1
```

O script (`deploy/backup.sh`) faz `pg_dump` comprimido, guarda 14 dias e **aborta antes de
apagar os antigos** se o dump novo sair suspeito de vazio.

Restaurar:

```bash
gunzip -c backups/aventura-AAAAMMDD-HHMMSS.sql.gz \
  | docker compose exec -T db psql -U aventura -d aventura
```

Copie os backups para fora do servidor também (`rclone`, `scp`, S3). Backup que mora no
mesmo disco que o banco não é backup.

---

## 7. Atualizar

```bash
cd /opt/aventura-das-notas
git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

As migrations rodam sozinhas na subida da API, uma vez cada, registradas na tabela
`_migrations`. Para adicionar mudanças de schema, crie o próximo arquivo numerado
(`server/migrations/003_xxx.sql`) — **nunca** edite uma migration já aplicada.

---

## 8. Endpoints

Tudo sob `/v1`. Autenticação por `Authorization: Bearer <access_token>`.

### Identidade
| Método | Rota | Para quê |
|---|---|---|
| POST | `/auth/dispositivo/registrar` | primeiro uso: cria identidade anônima do aparelho |
| POST | `/auth/dispositivo/entrar` | reautentica o aparelho pelo segredo |
| POST | `/auth/cadastro` | cria conta do responsável (exige `responsavel_confirmado`) |
| POST | `/auth/entrar` | login por e-mail e senha |
| POST | `/auth/renovar` | renova o access token (rotaciona o refresh) |
| POST | `/auth/sair` | revoga a sessão |
| GET | `/eu` | quem sou eu + meus jogadores |

### Jogadores
| Método | Rota | Para quê |
|---|---|---|
| GET/POST | `/jogadores` | listar / criar perfil |
| PATCH/DELETE | `/jogadores/:id` | renomear / remover |
| POST | `/jogadores/vincular` | levar o histórico anônimo para dentro da conta |

### Jogo
| Método | Rota | Para quê |
|---|---|---|
| POST | `/partidas` | registrar partida (idempotente, com anti-fraude) |
| GET | `/jogadores/:id/partidas` | histórico |
| GET | `/jogadores/:id/estatisticas` | recordes, precisão, evolução de 30 dias |
| GET | `/ranking` | ranking geral: topo com apelidos, minha posição e percentil |

### Turmas
| Método | Rota | Para quê |
|---|---|---|
| POST | `/turmas` | criar turma (gera código de 6 caracteres) |
| GET | `/turmas` | as que administro e as que participo |
| POST | `/turmas/entrar` | entrar com código |
| POST | `/turmas/sair` | sair |
| GET | `/turmas/:id/ranking` | ranking **com** apelidos (grupo fechado) |

### Moderação
| Método | Rota | Para quê |
|---|---|---|
| POST | `/denuncias` | denunciar apelido impróprio visto no ranking |

---

## 9. Decisões de segurança já implementadas

Não são planos: está no código e coberto por teste.

- **Senhas** com `scrypt` (N=32768), salt por senha, comparação em tempo constante.
  Sem dependência nativa para compilar.
- **Refresh token rotativo**: usar um refresh o revoga e emite outro. Reuso do antigo é
  recusado, o que limita a janela de um token vazado.
- **Só o hash** do refresh token e do segredo do aparelho vai para o banco. Um dump não
  permite se passar por ninguém.
- **JWT restrito a HS256**: o verificador recusa qualquer outro `alg`, inclusive `none`.
- **Enumeração de e-mail bloqueada**: senha errada e e-mail inexistente devolvem a mesma
  mensagem, e o caso inexistente gasta CPU equivalente para não vazar por timing.
- **Autorização central** em `lib/propriedade.js`: toda rota que recebe `jogador_id` do
  cliente confirma que o jogador é do chamador, e responde 404 (não 403) para não confirmar
  a existência de ids alheios.
- **Anti-fraude de pontuação**: o servidor reproduz o cronograma de spawn do jogo e calcula
  o teto de notas possível na duração informada. Rejeita 60 pontos em 60 segundos.
- **Rate limit** global de 300 req/min por IP, e 20 req/5min nas rotas de credencial.
- **Postgres nunca exposto**: publicado só em `127.0.0.1`, e em produção a própria API
  também (`API_BIND=127.0.0.1`).
- **Nenhum dado pessoal de criança**: só apelido e avatar. O titular da conta é o adulto.

## 10. Moderação de apelidos

O apelido aparece no **ranking geral**, visível a estranhos. Isso é conteúdo gerado por usuário
num app usado por crianças, e sustenta-se em duas barreiras:

1. **Filtro na escrita** — `server/src/lib/apelido.js`, aplicado em `POST` e `PATCH /jogadores`.
   Normaliza acento, leet e repetição antes de comparar, então `C4r@lh0` e `caaaralho` caem no
   mesmo lugar. É a primeira barreira, e **não pega tudo**.
2. **Denúncia** — `POST /v1/denuncias`, com botão no ranking do app.

### Revisar a fila de denúncias

```bash
docker compose exec db psql -U aventura -d aventura
```

```sql
-- Fila aberta, mais antigas primeiro
select d.id, d.apelido_no_momento, j.apelido as apelido_atual,
       d.motivo, d.observacao, d.criado_em
from denuncias d
left join jogadores j on j.id = d.jogador_id
where d.estado = 'aberta'
order by d.criado_em;

-- Procedente: renomeia o perfil e fecha
update jogadores set apelido = 'Jogador' where id = '<jogador_id>';
update denuncias set estado = 'procedente', revisado_em = now() where id = <id>;

-- Improcedente: só fecha
update denuncias set estado = 'improcedente', revisado_em = now() where id = <id>;
```

Vale colocar isso numa rotina semanal. Uma fila de denúncias que ninguém olha é pior do que
não ter canal — na revisão da loja, você afirma que existe moderação.

### Interruptor de emergência

Se a moderação não estiver dando conta, ou se uma loja questionar o placar público:

```ini
RANKING_MOSTRA_APELIDOS=false
```

O ranking geral volta a mostrar só posições e pontuações, sem identidade. O ranking de **turma**
continua com nomes — ali é grupo fechado com um adulto responsável como dono.

Outros ajustes por ambiente (ver `.env.example`):

| Variável | Default | Para quê |
|---|---|---|
| `RANKING_TAMANHO_TOPO` | 10 | quantos aparecem no topo |
| `RATE_LIMIT_GLOBAL` | 300/min | teto geral por IP |
| `RATE_LIMIT_AUTH` | 20/5min | freia força bruta no login |
| `RATE_LIMIT_DENUNCIA` | 10/10min | evita denúncia como spam |
| `RATE_LIMIT_PARTIDAS` | 120/min | envio de partidas |

> Estas variáveis precisam estar listadas no bloco `environment:` do `docker-compose.yml` para
> chegarem ao container. O `.env` do Compose serve para **interpolar** o arquivo, não para
> injetar variáveis automaticamente.

## 11. Login obrigatório

Com `exigirLogin: true` em `config.js` (o padrão), o jogo não abre sem sessão. Duas
consequências que não são contornáveis:

- **A primeira execução precisa de internet.** Sem sessão guardada não existe credencial.
  Depois do primeiro login o jogo funciona offline com a sessão local.
- **O servidor passa a ser caminho crítico.** Se a API cair, quem já entrou continua jogando,
  mas ninguém novo consegue entrar. Monitore `/health`.

Falha de rede **não** derruba a sessão — só um 401 do servidor derruba. Isso é proposital, e
está coberto por teste (`server/teste-cliente.mjs`, seção "Login obrigatorio").

Para gerar um build sem o portão (demonstração, quiosque, versão offline):

```powershell
$env:EXIGIR_LOGIN="0"; npm run aab
```

O build **recusa** a combinação `exigirLogin: true` sem `API_BASE`, que geraria um app onde o
portão simplesmente não existe.

## 12. O que ainda não existe

Honestamente, o que falta antes de considerar isto "completo" para produção:

1. **Verificação de e-mail e "esqueci minha senha".** A conta funciona, mas quem perder a
   senha não tem como recuperar. Precisa de um provedor de e-mail transacional
   (Resend, Postmark, SES).
2. **Moderação de apelido.** Hoje qualquer texto de 2 a 20 caracteres passa. Como o apelido
   aparece no ranking da turma, vale uma lista de bloqueio.
3. **Painel de moderação.** A fila de denúncias é revisada por SQL (seção 10). Funciona,
   mas não escala para outra pessoa fazer.
4. **Exclusão de conta pelo usuário.** A LGPD dá esse direito. O `on delete cascade` já
   está no schema; falta a rota e o botão.
5. **Observabilidade.** Não há métricas nem alerta. Para começar, basta um monitor externo
   batendo em `/health` (Uptime Kuma, BetterStack).
