/** Configuracao lida do ambiente. Falha rapido se algo essencial faltar. */

function obrigatorio(nome) {
  const v = process.env[nome];
  if (!v || !v.trim()) {
    console.error(`ERRO: variavel de ambiente ${nome} nao definida.`);
    process.exit(1);
  }
  return v.trim();
}

const JWT_SECRET = obrigatorio('JWT_SECRET');
if (JWT_SECRET.length < 32) {
  console.error('ERRO: JWT_SECRET curto demais (minimo 32 caracteres).');
  console.error('Gere um: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: obrigatorio('DATABASE_URL'),
  jwtSecret: JWT_SECRET,
  ehProducao: process.env.NODE_ENV === 'production',

  // Access token curto; refresh token longo e rotativo.
  accessTokenTtlSeg: 60 * 15,          // 15 min
  refreshTokenTtlSeg: 60 * 60 * 24 * 60, // 60 dias

  // Limites de requisicao. Os defaults sao os valores de PRODUCAO; em
  // desenvolvimento vale afrouxar, senao a propria suite de testes bate no
  // limite (ela dispara varias denuncias de proposito, do mesmo IP).
  limiteGlobal: Number(process.env.RATE_LIMIT_GLOBAL) || 300,
  limiteAuth: Number(process.env.RATE_LIMIT_AUTH) || 20,
  limiteDenuncia: Number(process.env.RATE_LIMIT_DENUNCIA) || 10,
  limitePartidas: Number(process.env.RATE_LIMIT_PARTIDAS) || 120,
  limiteTurma: Number(process.env.RATE_LIMIT_TURMA) || 20,

  // Interruptor de POLITICA, nao de tecnica: com false, o ranking geral deixa
  // de devolver apelidos e volta a mostrar so posicao e distribuicao. Util se a
  // moderacao nao estiver dando conta ou se uma loja questionar.
  rankingMostraApelidos: process.env.RANKING_MOSTRA_APELIDOS !== 'false',

  // Quantos aparecem no topo do ranking geral.
  rankingTamanhoTopo: Math.min(50, Number(process.env.RANKING_TAMANHO_TOPO) || 10),

  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
