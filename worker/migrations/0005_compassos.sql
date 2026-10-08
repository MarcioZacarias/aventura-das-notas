-- ============================================================================
-- Aceita os compassos 6/4 e 9/4, usados em hinos do hinario.
--
-- O SQLite nao altera CHECK de tabela existente: recria a tabela com a lista
-- nova e copia os dados.
-- ============================================================================

create table hinos_novo (
  id            integer primary key autoincrement,
  numero        integer not null unique check (numero between 1 and 9999),
  nome          text    not null check (length(trim(nome)) between 1 and 120),
  tom           text    not null check (length(tom) between 1 and 4),
  armadura      integer not null check (armadura between -7 and 7),
  compasso      text    not null
                check (compasso in ('2/2','2/4','3/2','3/4','3/8','4/4','6/4','6/8','9/4','9/8','12/8')),
  andamento     integer check (andamento between 20 and 300),
  trecho_sol    text,
  trecho_fa     text,
  trecho_do     text,
  ativo         integer not null default 1 check (ativo in (0, 1)),
  criado_em     text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

insert into hinos_novo select * from hinos;
drop table hinos;
alter table hinos_novo rename to hinos;

create index hinos_ativos_idx on hinos (numero) where ativo = 1;
