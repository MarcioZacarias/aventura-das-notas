-- ============================================================================
-- Hinos e configuracoes do administrador.
--
-- Os hinos sao cadastrados no painel (admin.html) pelo administrador, que so
-- cadastra o que tem direito de usar. Nada disso vem do codigo-fonte.
--
-- Trechos: notas escritas separadas por espaco ("E4 F4 G4 B4b"), uma voz por
-- clave — Sol le a voz de cima, Fa o baixo, Do (viola) o tenor. O formato e
-- interpretado por hinos.js.
-- ============================================================================

create table configuracoes (
  chave         text primary key,
  valor         text not null,
  atualizado_em text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A partir de que nivel da partida os trechos de hinos comecam a aparecer.
insert into configuracoes (chave, valor) values ('hinos_nivel_minimo', '3');

create table hinos (
  id            integer primary key autoincrement,
  numero        integer not null unique check (numero between 1 and 9999),
  nome          text    not null check (length(trim(nome)) between 1 and 120),
  tom           text    not null check (length(tom) between 1 and 4),
  armadura      integer not null check (armadura between -7 and 7),
  compasso      text    not null
                check (compasso in ('2/2','2/4','3/2','3/4','3/8','4/4','6/8','9/8','12/8')),
  andamento     integer check (andamento between 20 and 300),
  trecho_sol    text,
  trecho_fa     text,
  trecho_do     text,
  ativo         integer not null default 1 check (ativo in (0, 1)),
  criado_em     text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em text    not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index hinos_ativos_idx on hinos (numero) where ativo = 1;
