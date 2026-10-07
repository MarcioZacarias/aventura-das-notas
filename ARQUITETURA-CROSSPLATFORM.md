# Cross-platform, backend único, login, histórico e amizades

Resposta curta: **sim, tudo isso é possível, e a escolha do Capacitor já foi feita pensando nisso.**
O jogo continua sendo o mesmo HTML/JS de hoje; o que muda é que passam a existir duas cascas
nativas (Android e iOS) e um backend compartilhado.

```
                    mesmo código do jogo (index.html + game.js)
                                     │
                  ┌──────────────────┴──────────────────┐
                  │                                     │
        Capacitor Android                      Capacitor iOS
        (Play Store)                           (App Store)
                  │                                     │
                  └──────────────────┬──────────────────┘
                                     │
                          um único backend + um único banco
                     (auth, histórico de partidas, amizades, ranking)
```

---

## 1. iOS: mesmo código, mas com dois custos reais

Adicionar iOS é literalmente `npx cap add ios` — **o código do jogo não muda em nada**.
Os obstáculos não são técnicos, são de plataforma:

| | Google Play | Apple App Store |
|---|---|---|
| Taxa | US$ 25, **uma vez** | US$ 99, **por ano** |
| Máquina de build | Windows serve | **exige macOS + Xcode** |
| Revisão | mais permissiva | mais rigorosa |

### Como buildar iOS sem ter um Mac

Você está no Windows, então o build iOS precisa acontecer em outro lugar. Em ordem de custo-benefício:

1. **GitHub Actions com runner `macos-latest`** — a melhor opção para o seu caso.
   O repositório já está no GitHub. Um workflow faz `npm run build`, `cap sync ios`,
   `xcodebuild` e sobe para o TestFlight via [fastlane](https://fastlane.tools).
   Você nunca toca num Mac. Repositórios públicos têm minutos gratuitos;
   em privado, minutos de macOS custam 10× os de Linux.
2. **Mac na nuvem** (MacinCloud, MacStadium, Scaleway Mac mini) — aluguel por hora/mês,
   útil para depurar de verdade.
3. **Mac mini usado** — se iOS virar um canal permanente, sai mais barato no longo prazo.

> Não rode `npx cap add ios` nesta máquina Windows: a pasta é gerada, mas o `pod install`
> (CocoaPods) falha e você fica com um projeto pela metade. Adicione a plataforma direto no
> Mac ou no CI.

---

## 2. Backend e banco de dados únicos

O ponto central: **o WebView é o mesmo nas duas plataformas**, então um SDK JavaScript
funciona igual no Android e no iOS, sem código nativo e sem duplicação.

### Recomendação: Supabase

**Postgres gerenciado + Auth + Row Level Security + Realtime.** Motivos concretos para o seu caso:

- **Amizades e ranking são problemas relacionais.** Grafo de amizade, "top 10 dos meus amigos",
  "minha evolução por clave nos últimos 30 dias" — tudo isso é um `JOIN` e um `GROUP BY` em SQL.
  Em banco NoSQL isso vira desnormalização manual e dor de cabeça.
- **Row Level Security** deixa a regra "só vejo meus dados e os dos meus amigos" **no banco**,
  não no app. Num app cliente-direto isso é o que impede um jogador de ler dados de outro.
- **Realtime** de graça para convites de amizade e ranking ao vivo.
- SDK JS único para Android, iOS e web.

### Por que *não* Firebase, especificamente aqui

Firebase funcionaria, mas tem um atrito importante: o **Firebase Analytics coleta o
identificador de publicidade (AAID/IDFA)** por padrão. Em app cujo público-alvo inclui
crianças, isso é exatamente o que a Política de Famílias do Google Play e as regras da
Apple para Kids proíbem. Dá para desativar, mas você passa a lutar contra o default da
ferramenta. Some a isso o Firestore ser NoSQL, e o Supabase fica mais adequado.

### Esboço do schema

```sql
-- Perfil do jogador (nunca guarde dados pessoais de criança aqui — ver seção 3)
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  apelido     text not null check (char_length(apelido) between 2 and 20),
  avatar      text,                      -- emoji, não foto
  criado_em   timestamptz default now()
);

-- Histórico: uma linha por partida encerrada
create table partidas (
  id            bigint generated always as identity primary key,
  jogador_id    uuid not null references profiles(id) on delete cascade,
  clave         text not null check (clave in ('sol','fa','do')),
  pontuacao     int  not null check (pontuacao >= 0),
  nivel_max     int  not null,
  acertos       int  not null,
  erros         int  not null,
  duracao_seg   int  not null,
  jogada_em     timestamptz default now()
);
create index on partidas (jogador_id, jogada_em desc);
create index on partidas (clave, pontuacao desc);

-- Amizades: uma linha por par, com estado
create table amizades (
  solicitante_id uuid not null references profiles(id) on delete cascade,
  destinatario_id uuid not null references profiles(id) on delete cascade,
  estado         text not null default 'pendente'
                 check (estado in ('pendente','aceita','bloqueada')),
  criado_em      timestamptz default now(),
  primary key (solicitante_id, destinatario_id),
  check (solicitante_id <> destinatario_id)
);

-- View auxiliar: amizades aceitas nos dois sentidos
create view amigos as
  select solicitante_id as jogador_id, destinatario_id as amigo_id from amizades where estado = 'aceita'
  union all
  select destinatario_id as jogador_id, solicitante_id as amigo_id from amizades where estado = 'aceita';
```

E as políticas que fazem o trabalho de segurança:

```sql
alter table profiles enable row level security;
alter table partidas enable row level security;
alter table amizades enable row level security;

-- Vejo meu perfil e o dos meus amigos
create policy "perfil visivel" on profiles for select
  using (
    id = auth.uid()
    or exists (select 1 from amigos where jogador_id = auth.uid() and amigo_id = profiles.id)
  );

-- Só escrevo partidas minhas
create policy "insere propria partida" on partidas for insert
  with check (jogador_id = auth.uid());

-- Vejo minhas partidas e as dos meus amigos
create policy "partidas visiveis" on partidas for select
  using (
    jogador_id = auth.uid()
    or exists (select 1 from amigos where jogador_id = auth.uid() and amigo_id = partidas.jogador_id)
  );

-- Só participo de amizades que envolvem a mim
create policy "amizades proprias" on amizades for all
  using (solicitante_id = auth.uid() or destinatario_id = auth.uid())
  with check (solicitante_id = auth.uid() or destinatario_id = auth.uid());
```

> Nota: pontuação enviada pelo cliente é **sempre falsificável**. Um jogador determinado
> pode gravar `pontuacao: 999999`. Se o ranking for competitivo de verdade, valide no servidor
> (Edge Function) com limites plausíveis — pontuação máxima possível dada a duração da partida.

---

## 3. ⚠️ O problema que precisa ser decidido antes de codar: é um app infantil

Isto não é burocracia, é o que decide se o app é aprovado ou removido.

Um jogo de aprendizado de notas musicais, com mascote, "Comic Sans" e emojis, será
classificado como **dirigido a crianças**. Isso ativa, ao mesmo tempo:

- **Política de Famílias do Google Play** — proibido coletar dados pessoais de crianças sem
  consentimento verificável dos pais.
- **App Store Review Guidelines 1.3 e 5.1.4** (Kids Category) — restrições fortes a login,
  links externos e redes sociais abertas.
- **LGPD, Art. 14** — dados de criança exigem consentimento **específico e destacado** de
  pelo menos um dos pais ou responsável legal.
- **COPPA**, se publicar nos EUA.

O ponto duro: **"amizade entre jogadores" é rede social.** Login com e-mail, nome de perfil e
lista de amigos são dados pessoais de menores, e conexão entre usuários exige também
moderação, denúncia e bloqueio.

### Três caminhos, do mais seguro ao mais caro

**A) Progresso local + conta do responsável/professor** — *recomendado para começar*

- A criança joga **sem login nenhum**. Histórico local no aparelho.
- Quem cria conta é o **adulto** (pai, mãe ou professor) — e aí o titular dos dados é maior de idade,
  o que sai do escopo mais pesado da regra.
- "Amizade" vira **turma/família**: o adulto gera um código, e os perfis ficam sob a conta dele.
  Ranking dentro da turma, sem descoberta de estranhos.
- Nenhum dado pessoal da criança: só um apelido escolhido pelo adulto e um emoji de avatar.

É o modelo que Duolingo ABC e Khan Academy Kids usam. Entrega ranking, histórico e comparação
entre jogadores com uma fração do risco e do trabalho.

**B) Conta anônima com "adoção" pelo adulto** — bom meio de caminho

- `supabase.auth.signInAnonymously()` no primeiro uso: o progresso já sincroniza entre
  reinstalações e aparelhos, **sem coletar nada** — sem e-mail, sem nome.
- Depois, opcionalmente, um adulto "assume" o perfil informando o e-mail dele, e só então
  entram recursos sociais.
- Data safety continua declarando quase nada na v1.

**C) Social completo com consentimento parental verificável** — evite por ora

Exige fluxo de verificação de responsável (e-mail + confirmação por cobrança simbólica ou documento),
moderação de conteúdo, canal de denúncia e bloqueio, e revisão mais dura nas duas lojas.
Só faz sentido com o app já validado e com usuários.

> Não tente escapar declarando "público-alvo: 13+". O Google avalia o ícone, os screenshots e a
> descrição da ficha. Declarar público adulto num app visivelmente infantil é violação de política
> e dá suspensão.

### Recomendação prática

Publique a **v1.0 como está: offline, sem conta, sem coleta de dados**. É a aprovação mais
rápida e menos arriscada, e te dá a conta de desenvolvedor validada e o app no ar.
Depois evolua para **A** ou **B**, que é onde estão os recursos que você quer.

---

## 4. Armazenamento local (vale fazer já, é barato)

Antes de qualquer backend, guarde o progresso no aparelho. Use o
[`@capacitor/preferences`](https://capacitorjs.com/docs/apis/preferences) em vez de `localStorage`
— o WebView pode limpar `localStorage` sob pressão de memória, e o plugin grava em
`SharedPreferences` (Android) / `UserDefaults` (iOS).

```powershell
npm install @capacitor/preferences
npm run sync
```

Isso já habilita recorde por clave, total de partidas e evolução — tudo offline. E vira a
base do que depois sincroniza com o backend.

---

## 5. Arquitetura offline-first

Um detalhe importante: hoje o jogo **funciona 100% offline**, e isso é uma virtude
(criança no carro, escola sem wi-fi, e ainda simplifica a política de privacidade).
Não jogue isso fora ao adicionar backend.

O padrão correto:

1. A partida termina → grava **local** na hora. O jogo nunca espera a rede.
2. Uma fila de sincronização sobe o que está pendente quando há conexão.
3. O servidor é a fonte de verdade só para o que é **compartilhado** (amizades, ranking).
4. Sem rede, o jogo funciona inteiro; só os recursos sociais ficam indisponíveis.

Isso também mantém a CSP fechada: em `scripts/build-www.mjs`, adicione só o domínio da API
em `connect-src` quando o backend entrar.

---

## 6. Roteiro sugerido

| Fase | Escopo | Onde publica |
|---|---|---|
| **1** | Corrigir os glifos de clave, recorde local com `@capacitor/preferences`, publicar | Play Store |
| **2** | Adicionar iOS via GitHub Actions + TestFlight (mesmo código) | App Store |
| **3** | Supabase com auth anônima: histórico sincronizado, sem PII | ambas |
| **4** | Conta de responsável/professor + turmas + ranking da turma | ambas |
| **5** | Amizades diretas, se e quando fizer sentido — com consentimento e moderação | ambas |

A fase 1 é o que está a poucos passos de pronto agora. Veja as pendências técnicas
na seção 6 de [PUBLICAR-ANDROID.md](PUBLICAR-ANDROID.md).
