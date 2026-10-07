-- ============================================================================
-- Aventura das Notas - schema inicial (Cloudflare D1 / SQLite)
--
-- Porte de server/migrations/001_init.sql. Mesmo modelo, com as adaptacoes que
-- o SQLite exige:
--   - uuid        -> text, gerado na aplicacao (crypto.randomUUID)
--   - timestamptz -> text ISO 8601 em UTC ("2026-10-07T12:00:00.000Z"). Esse
--                    formato ordena e compara corretamente como texto.
--   - boolean     -> integer 0/1
--   - regex (~)   -> GLOB
--
-- Principio de projeto: o titular da conta e o ADULTO responsavel (pai, mae ou
-- professor). A crianca nao tem conta e nao fornece dado pessoal: ela e um
-- "jogador", identificado apenas por apelido e um emoji de avatar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONTAS: o adulto responsavel
-- ---------------------------------------------------------------------------
create table contas (
  id                      text primary key,
  -- Guardado sempre em minusculas (normalizado na aplicacao).
  email                   text    not null unique,
  senha_hash              text    not null,
  nome                    text    not null check (length(trim(nome)) between 2 and 80),
  -- Declaracao de que quem criou a conta e maior de idade e responsavel pelos
  -- jogadores cadastrados. Exigida na LGPD Art. 14.
  responsavel_confirmado  integer not null default 0 check (responsavel_confirmado in (0, 1)),
  email_verificado        integer not null default 0 check (email_verificado in (0, 1)),
  criado_em               text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultimo_acesso_em        text
);

-- ---------------------------------------------------------------------------
-- SESSOES: refresh tokens. Guardamos apenas o HASH do token, nunca o valor.
-- ---------------------------------------------------------------------------
create table sessoes (
  id           text primary key,
  conta_id     text not null references contas(id) on delete cascade,
  token_hash   text not null unique,
  expira_em    text not null,
  criado_em    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revogada_em  text,
  user_agent   text
);

create index sessoes_conta_idx on sessoes (conta_id) where revogada_em is null;
create index sessoes_expira_idx on sessoes (expira_em);

-- ---------------------------------------------------------------------------
-- DISPOSITIVOS: identidade anonima do aparelho. Guardamos apenas o hash do
-- segredo, entao um dump do banco nao da acesso a nada.
-- ---------------------------------------------------------------------------
create table dispositivos (
  id               text primary key,
  segredo_hash     text not null,
  plataforma       text check (plataforma in ('android', 'ios', 'web')),
  criado_em        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ultimo_acesso_em text
);

-- ---------------------------------------------------------------------------
-- JOGADORES: perfis de quem joga. SEM dado pessoal.
--   a) anonimo   -> dispositivo_id preenchido, conta_id nulo.
--   b) vinculado -> conta_id preenchido (um adulto "adotou" o perfil).
-- ---------------------------------------------------------------------------
create table jogadores (
  id             text primary key,
  conta_id       text references contas(id) on delete cascade,
  dispositivo_id text references dispositivos(id) on delete cascade,
  apelido        text not null check (length(trim(apelido)) between 2 and 20),
  avatar         text not null default 'musica' check (length(avatar) <= 16),
  criado_em      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

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
  id                 integer primary key autoincrement,
  jogador_id         text    not null references jogadores(id) on delete cascade,
  cliente_partida_id text    not null,
  clave              text    not null check (clave in ('sol', 'fa', 'do')),
  pontuacao          integer not null check (pontuacao >= 0),
  nivel_max          integer not null check (nivel_max >= 1),
  acertos            integer not null check (acertos >= 0),
  erros              integer not null check (erros >= 0),
  duracao_ms         integer not null check (duracao_ms > 0),
  jogada_em          text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Mesma partida reenviada pela fila offline nao entra duas vezes.
  constraint partida_unica_por_jogador unique (jogador_id, cliente_partida_id)
);

create index partidas_jogador_data_idx on partidas (jogador_id, jogada_em desc);
create index partidas_ranking_idx on partidas (clave, pontuacao desc, jogada_em);
create index partidas_data_idx on partidas (jogada_em desc);

-- ---------------------------------------------------------------------------
-- TURMAS: o adulto cria uma turma e distribui um codigo. So quem tem o codigo
-- entra. Ranking com apelidos acontece dentro da turma.
-- ---------------------------------------------------------------------------
create table turmas (
  id             text primary key,
  dono_conta_id  text not null references contas(id) on delete cascade,
  nome           text not null check (length(trim(nome)) between 2 and 60),
  -- Codigo curto de convite, alfabeto sem caracteres ambiguos. Gerado na API.
  codigo         text not null unique
                 check (length(codigo) = 6 and codigo not glob '*[^A-HJ-NP-Z2-9]*'),
  criado_em      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index turmas_dono_idx on turmas (dono_conta_id);

create table turma_membros (
  turma_id   text not null references turmas(id) on delete cascade,
  jogador_id text not null references jogadores(id) on delete cascade,
  entrou_em  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (turma_id, jogador_id)
);

create index turma_membros_jogador_idx on turma_membros (jogador_id);
