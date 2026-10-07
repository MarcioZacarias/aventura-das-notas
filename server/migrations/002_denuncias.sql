-- ============================================================================
-- Canal de denuncia.
--
-- Obrigatorio a partir do momento em que apelidos escritos por usuarios ficam
-- visiveis publicamente no ranking geral: conteudo gerado por usuario exposto
-- a estranhos exige, na Politica de Familias do Google Play e nas App Review
-- Guidelines da Apple, filtro E canal de denuncia com revisao humana.
--
-- A lista de bloqueio (server/src/lib/apelido.js) e a primeira barreira; esta
-- tabela e a segunda, e a unica que pega o que o filtro nao previu.
-- ============================================================================

create table denuncias (
  id                bigint generated always as identity primary key,

  -- Quem denunciou. Pode ser conta ou aparelho anonimo, por isso os dois
  -- campos sao opcionais — mas ao menos um precisa estar preenchido.
  denunciante_conta_id       uuid references contas(id) on delete set null,
  denunciante_dispositivo_id uuid references dispositivos(id) on delete set null,

  -- Alvo. Mantemos o apelido copiado no momento da denuncia: se a pessoa
  -- trocar de apelido depois, o moderador ainda sabe o que foi denunciado.
  jogador_id        uuid references jogadores(id) on delete set null,
  apelido_no_momento text not null,

  motivo            text not null check (motivo in ('apelido_ofensivo','outro')),
  observacao        text check (char_length(observacao) <= 500),

  estado            text not null default 'aberta'
                    check (estado in ('aberta','procedente','improcedente')),
  criado_em         timestamptz not null default now(),
  revisado_em       timestamptz,

  constraint denuncia_tem_autor check (
    denunciante_conta_id is not null or denunciante_dispositivo_id is not null
  )
);

-- Fila de moderacao: o que esta aberto, mais antigo primeiro.
create index denuncias_abertas_idx on denuncias (criado_em) where estado = 'aberta';
create index denuncias_jogador_idx on denuncias (jogador_id);

-- Evita que a mesma pessoa denuncie o mesmo jogador repetidamente e infle a
-- fila. Uma denuncia aberta por par (denunciante, alvo) e suficiente.
create unique index denuncias_sem_repeticao_conta_idx
  on denuncias (denunciante_conta_id, jogador_id)
  where estado = 'aberta' and denunciante_conta_id is not null;

create unique index denuncias_sem_repeticao_dispositivo_idx
  on denuncias (denunciante_dispositivo_id, jogador_id)
  where estado = 'aberta' and denunciante_dispositivo_id is not null;
