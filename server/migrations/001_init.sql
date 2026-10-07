-- ============================================================================
-- Aventura das Notas - schema inicial
--
-- Principio de projeto: o titular da conta e o ADULTO responsavel (pai, mae ou
-- professor). A crianca nao tem conta e nao fornece dado pessoal: ela e um
-- "jogador", identificado apenas por apelido e um emoji de avatar.
--
-- Isso e o que mantem o app dentro da Politica de Familias do Google Play, das
-- regras Kids da Apple e do Art. 14 da LGPD, sem abrir mao de historico,
-- ranking e turmas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONTAS: o adulto responsavel
-- ---------------------------------------------------------------------------
create table contas (
  id                      uuid primary key default gen_random_uuid(),
  -- Guardado sempre em minusculas (normalizado na aplicacao) para o unique
  -- funcionar sem depender da extensao citext.
  email                   text        not null unique,
  senha_hash              text        not null,
  nome                    text        not null check (char_length(trim(nome)) between 2 and 80),
  -- Declaracao explicita de que quem criou a conta e maior de idade e
  -- responsavel pelos jogadores cadastrados. Exigida na LGPD Art. 14.
  responsavel_confirmado  boolean     not null default false,
  email_verificado        boolean     not null default false,
  criado_em               timestamptz not null default now(),
  ultimo_acesso_em        timestamptz
);

create index contas_email_idx on contas (email);

-- ---------------------------------------------------------------------------
-- SESSOES: refresh tokens. Guardamos apenas o HASH do token, nunca o valor.
-- ---------------------------------------------------------------------------
create table sessoes (
  id           uuid primary key default gen_random_uuid(),
  conta_id     uuid        not null references contas(id) on delete cascade,
  token_hash   text        not null unique,
  expira_em    timestamptz not null,
  criado_em    timestamptz not null default now(),
  revogada_em  timestamptz,
  user_agent   text
);

create index sessoes_conta_idx on sessoes (conta_id) where revogada_em is null;
create index sessoes_expira_idx on sessoes (expira_em);

-- ---------------------------------------------------------------------------
-- DISPOSITIVOS: identidade anonima do aparelho.
--
-- Permite que a crianca jogue e tenha historico sincronizado SEM cadastro
-- nenhum. O aparelho recebe um id e um segredo no primeiro uso; guardamos
-- apenas o hash do segredo, entao um dump do banco nao da acesso a nada.
--
-- Nao e identificador de publicidade nem de hardware: e um valor aleatorio
-- emitido pelo servidor, descartavel.
-- ---------------------------------------------------------------------------
create table dispositivos (
  id               uuid primary key default gen_random_uuid(),
  segredo_hash     text        not null,
  plataforma       text        check (plataforma in ('android','ios','web')),
  criado_em        timestamptz not null default now(),
  ultimo_acesso_em timestamptz
);

-- ---------------------------------------------------------------------------
-- JOGADORES: perfis de quem joga. SEM dado pessoal.
--
-- Dois modos de existencia:
--   a) anonimo  -> dispositivo_id preenchido, conta_id nulo.
--                  A crianca joga sem cadastro; o historico sincroniza preso
--                  ao aparelho.
--   b) vinculado -> conta_id preenchido. Um adulto "adotou" o perfil, e a partir
--                  dai ele pode entrar em turmas e migrar de aparelho.
-- ---------------------------------------------------------------------------
create table jogadores (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid references contas(id) on delete cascade,
  dispositivo_id uuid references dispositivos(id) on delete cascade,
  apelido        text        not null check (char_length(trim(apelido)) between 2 and 20),
  avatar         text        not null default 'musica' check (char_length(avatar) <= 16),
  criado_em      timestamptz not null default now(),

  -- Todo jogador precisa de um dono: uma conta ou um aparelho.
  constraint jogador_tem_dono check (conta_id is not null or dispositivo_id is not null)
);

create index jogadores_conta_idx on jogadores (conta_id);
create index jogadores_dispositivo_idx on jogadores (dispositivo_id);

-- ---------------------------------------------------------------------------
-- PARTIDAS: uma linha por partida encerrada.
--
-- cliente_partida_id: UUID gerado no aparelho ANTES de enviar. Torna o envio
-- idempotente, que e o que permite a fila offline reenviar sem duplicar.
-- ---------------------------------------------------------------------------
create table partidas (
  id                 bigint generated always as identity primary key,
  jogador_id         uuid        not null references jogadores(id) on delete cascade,
  cliente_partida_id uuid        not null,
  clave              text        not null check (clave in ('sol','fa','do')),
  pontuacao          int         not null check (pontuacao >= 0),
  nivel_max          int         not null check (nivel_max >= 1),
  acertos            int         not null check (acertos >= 0),
  erros              int         not null check (erros >= 0),
  duracao_ms         int         not null check (duracao_ms > 0),
  jogada_em          timestamptz not null default now(),

  -- Mesma partida reenviada pela fila offline nao entra duas vezes.
  constraint partida_unica_por_jogador unique (jogador_id, cliente_partida_id)
);

create index partidas_jogador_data_idx on partidas (jogador_id, jogada_em desc);
create index partidas_ranking_idx on partidas (clave, pontuacao desc, jogada_em);
create index partidas_data_idx on partidas (jogada_em desc);

-- ---------------------------------------------------------------------------
-- TURMAS: substituem "amizade entre jogadores".
--
-- Em vez de descoberta aberta de estranhos (que exigiria moderacao, denuncia e
-- consentimento parental verificavel), o adulto cria uma turma e distribui um
-- codigo. Só quem tem o codigo entra. Ranking acontece dentro da turma.
-- ---------------------------------------------------------------------------
create table turmas (
  id             uuid primary key default gen_random_uuid(),
  dono_conta_id  uuid        not null references contas(id) on delete cascade,
  nome           text        not null check (char_length(trim(nome)) between 2 and 60),
  -- Codigo curto de convite, alfabeto sem caracteres ambiguos. Gerado na API.
  codigo         text        not null unique check (codigo ~ '^[A-HJ-NP-Z2-9]{6}$'),
  criado_em      timestamptz not null default now()
);

create index turmas_dono_idx on turmas (dono_conta_id);

create table turma_membros (
  turma_id   uuid        not null references turmas(id) on delete cascade,
  jogador_id uuid        not null references jogadores(id) on delete cascade,
  entrou_em  timestamptz not null default now(),
  primary key (turma_id, jogador_id)
);

create index turma_membros_jogador_idx on turma_membros (jogador_id);
