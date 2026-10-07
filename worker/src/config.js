/**
 * Configuracao lida do ambiente do Worker (vars do wrangler.jsonc + secrets).
 *
 * JWT_SECRET e secret, nunca var: defina com
 *   npx wrangler secret put JWT_SECRET
 */

export function lerConfig(env) {
  const jwtSecret = String(env.JWT_SECRET || '').trim();
  if (jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET ausente ou curto demais (minimo 32 caracteres). ' +
        'Defina com: npx wrangler secret put JWT_SECRET'
    );
  }

  return {
    jwtSecret,

    // Access token curto; refresh token longo e rotativo.
    accessTokenTtlSeg: 60 * 15, // 15 min
    refreshTokenTtlSeg: 60 * 60 * 24 * 60, // 60 dias

    // Custo do hash de senha. 100000 e o maximo que o PBKDF2 do Workers aceita.
    // O valor fica gravado junto do hash, entao mudar aqui nao invalida senhas.
    pbkdf2Iteracoes: Math.min(100000, Number(env.PBKDF2_ITERACOES) || 100000),

    // Interruptor de POLITICA: com false, o ranking geral deixa de devolver
    // apelidos e volta a mostrar so posicao e distribuicao.
    rankingMostraApelidos: String(env.RANKING_MOSTRA_APELIDOS) !== 'false',
    rankingTamanhoTopo: Math.min(50, Number(env.RANKING_TAMANHO_TOPO) || 10),

    // So para a suite de testes local (.dev.vars). Nunca em producao.
    limitesDesligados: String(env.RATE_LIMIT_DESLIGADO) === 'true',

    corsOrigins: String(env.CORS_ORIGINS || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
