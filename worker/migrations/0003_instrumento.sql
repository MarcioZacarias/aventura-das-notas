-- ============================================================================
-- Instrumento de preferencia de cada jogador.
--
-- Define o timbre das notas e quais claves o jogo libera (ver instrumentos.js).
-- Nulo = ainda nao escolheu; o app pede a escolha antes de jogar.
-- O catalogo de ids vive no cliente; aqui so garantimos o formato.
-- ============================================================================

alter table jogadores add column instrumento text
  check (instrumento is null or (length(instrumento) between 2 and 32
                                 and instrumento not glob '*[^a-z_]*'));
