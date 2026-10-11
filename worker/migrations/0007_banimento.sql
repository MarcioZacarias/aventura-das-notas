-- ============================================================================
-- Gestao de contas pelo administrador: banimento.
--
-- Conta banida nao entra, perde as sessoes abertas e os perfis dela somem do
-- ranking geral e dos rankings de turma. Desbanir devolve tudo como estava
-- (nada e apagado).
-- ============================================================================

alter table contas add column banida_em text;
alter table contas add column ban_motivo text check (ban_motivo is null or length(ban_motivo) <= 300);

create index contas_banidas_idx on contas (banida_em) where banida_em is not null;
