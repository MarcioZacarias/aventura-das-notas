-- ============================================================================
-- Canal de denuncia (porte de server/migrations/002_denuncias.sql).
--
-- Obrigatorio a partir do momento em que apelidos escritos por usuarios ficam
-- visiveis publicamente no ranking geral. A lista de bloqueio
-- (server/src/lib/apelido.js) e a primeira barreira; esta tabela e a segunda.
-- ============================================================================

create table denuncias (
  id                         integer primary key autoincrement,

  -- Quem denunciou: conta ou aparelho anonimo, ao menos um dos dois.
  denunciante_conta_id       text references contas(id) on delete set null,
  denunciante_dispositivo_id text references dispositivos(id) on delete set null,

  -- Apelido copiado no momento da denuncia: se a pessoa trocar de apelido
  -- depois, o moderador ainda sabe o que foi denunciado.
  jogador_id                 text references jogadores(id) on delete set null,
  apelido_no_momento         text not null,

  motivo                     text not null check (motivo in ('apelido_ofensivo', 'outro')),
  observacao                 text check (length(observacao) <= 500),

  estado                     text not null default 'aberta'
                             check (estado in ('aberta', 'procedente', 'improcedente')),
  criado_em                  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revisado_em                text,

  constraint denuncia_tem_autor check (
    denunciante_conta_id is not null or denunciante_dispositivo_id is not null
  )
);

-- Fila de moderacao: o que esta aberto, mais antigo primeiro.
create index denuncias_abertas_idx on denuncias (criado_em) where estado = 'aberta';
create index denuncias_jogador_idx on denuncias (jogador_id);

-- Uma denuncia aberta por par (denunciante, alvo) e suficiente.
create unique index denuncias_sem_repeticao_conta_idx
  on denuncias (denunciante_conta_id, jogador_id)
  where estado = 'aberta' and denunciante_conta_id is not null;

create unique index denuncias_sem_repeticao_dispositivo_idx
  on denuncias (denunciante_dispositivo_id, jogador_id)
  where estado = 'aberta' and denunciante_dispositivo_id is not null;
