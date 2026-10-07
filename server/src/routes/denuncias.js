/**
 * Canal de denuncia de apelido.
 *
 * A lista de bloqueio em lib/apelido.js pega o obvio. Isto pega o resto — e e
 * o que torna defensavel exibir apelidos no ranking geral de um app usado por
 * criancas. Sem canal de denuncia, o ranking publico com nomes nao passa na
 * Politica de Familias.
 *
 * Nao ha rota de moderacao exposta aqui de proposito: a revisao acontece no
 * banco (ver server/DEPLOY.md, secao de moderacao). Um painel administrativo
 * pela API precisaria de papel de admin e autenticacao propria, e seria mais
 * superficie de ataque do que o volume atual justifica.
 */
import { q } from '../db.js';
import { exigirAuth } from '../lib/autenticacao.js';
import { config } from '../config.js';

const UNIQUE_VIOLATION = '23505';

export default async function rotasDenuncias(app) {
  app.post(
    '/denuncias',
    {
      preHandler: exigirAuth,
      // Denuncia e acao rara; limite baixo desencoraja uso como spam.
      config: { rateLimit: { max: config.limiteDenuncia, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['jogador_id', 'motivo'],
          properties: {
            jogador_id: { type: 'string', format: 'uuid' },
            motivo: { type: 'string', enum: ['apelido_ofensivo', 'outro'] },
            observacao: { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, resposta) => {
      const { tipo, id: autorId } = req.autenticado;
      const { jogador_id, motivo, observacao } = req.body;

      // Le o apelido atual para congelar no registro: se a pessoa trocar de
      // apelido depois, o moderador ainda ve o que foi denunciado.
      const { rows: alvo } = await q('select id, apelido from jogadores where id = $1', [
        jogador_id,
      ]);
      if (!alvo.length) {
        return resposta.code(404).send({ erro: 'Jogador nao encontrado.' });
      }

      // Nao faz sentido denunciar o proprio perfil.
      const coluna = tipo === 'conta' ? 'conta_id' : 'dispositivo_id';
      const { rows: meu } = await q(
        `select 1 from jogadores where id = $1 and ${coluna} = $2`,
        [jogador_id, autorId]
      );
      if (meu.length) {
        return resposta.code(400).send({ erro: 'Nao e possivel denunciar o proprio perfil.' });
      }

      try {
        await q(
          `insert into denuncias
             (denunciante_conta_id, denunciante_dispositivo_id,
              jogador_id, apelido_no_momento, motivo, observacao)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            tipo === 'conta' ? autorId : null,
            tipo === 'dispositivo' ? autorId : null,
            jogador_id,
            alvo[0].apelido,
            motivo,
            observacao ?? null,
          ]
        );
      } catch (e) {
        // Ja existe denuncia aberta desta pessoa sobre este alvo: responde ok,
        // para nao revelar o estado da fila nem incentivar reenvio.
        if (e.code === UNIQUE_VIOLATION) {
          return { ok: true, ja_denunciado: true };
        }
        throw e;
      }

      req.log.info({ jogador_id, motivo }, 'denuncia registrada');
      return { ok: true, ja_denunciado: false };
    }
  );
}
