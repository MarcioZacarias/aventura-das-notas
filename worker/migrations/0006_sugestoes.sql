-- ============================================================================
-- Sugestoes dos usuarios.
--
-- Qualquer pessoa logada (conta) ou aparelho anonimo pode sugerir. Ninguem ve
-- a sugestao de outro: so o autor e o administrador. O administrador muda o
-- estado; quando vira 'implementada', o autor recebe o aviso no jogo.
--
-- Estados: recebida -> em_avaliacao -> aceita -> implementada
--                                    \-> recusada
-- ============================================================================

create table sugestoes (
  id                integer primary key autoincrement,
  conta_id          text references contas(id) on delete cascade,
  dispositivo_id    text references dispositivos(id) on delete cascade,
  -- Perfil que estava jogando, so para o admin saber de quem veio (apelido
  -- copiado: o perfil pode mudar de nome ou ser apagado depois).
  apelido           text,
  texto             text not null check (length(trim(texto)) between 5 and 1000),
  estado            text not null default 'recebida'
                    check (estado in ('recebida', 'em_avaliacao', 'aceita', 'implementada', 'recusada')),
  resposta          text check (resposta is null or length(resposta) <= 500),
  -- Autor ja viu a ultima mudanca de estado? 0 = tem novidade para mostrar.
  autor_viu         integer not null default 1 check (autor_viu in (0, 1)),
  criado_em         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  constraint sugestao_tem_autor check (conta_id is not null or dispositivo_id is not null)
);

create index sugestoes_conta_idx on sugestoes (conta_id);
create index sugestoes_dispositivo_idx on sugestoes (dispositivo_id);
create index sugestoes_estado_idx on sugestoes (estado, criado_em);
