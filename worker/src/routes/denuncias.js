/**
 * Canal de denuncia de apelido.
 *
 * A lista de bloqueio pega o obvio. Isto pega o resto — e e o que torna
 * defensavel exibir apelidos no ranking geral de um app usado por criancas.
 *
 * Nao ha rota de moderacao exposta de proposito: a revisao acontece direto no
 * banco (ver worker/README.md, secao de moderacao).
 */
import { falha } from '../http.js';
import { executar, primeiro, violouUnico } from '../db.js';
import { colunaDono } from '../lib/acesso.js';

export default [
  {
    metodo: 'POST',
    caminho: '/v1/denuncias',
    auth: true,
    // Denuncia e acao rara; limite baixo desencoraja uso como spam.
    limite: 'LIMITE_DENUNCIA',
    corpo: {
      type: 'object',
      required: ['jogador_id', 'motivo'],
      properties: {
        jogador_id: { type: 'string', format: 'uuid' },
        motivo: { type: 'string', enum: ['apelido_ofensivo', 'outro'] },
        observacao: { type: 'string', maxLength: 500 },
      },
    },
    async handler(c) {
      const { tipo, id: autorId } = c.auth;
      const { jogador_id, motivo, observacao } = c.corpo;

      // Le o apelido atual para congelar no registro.
      const alvo = await primeiro(c.db, 'select id, apelido from jogadores where id = ?', jogador_id);
      if (!alvo) throw falha(404, 'Jogador nao encontrado.');

      // Nao faz sentido denunciar o proprio perfil.
      const meu = await primeiro(
        c.db,
        `select 1 as sim from jogadores where id = ? and ${colunaDono(c.auth)} = ?`,
        jogador_id,
        autorId
      );
      if (meu) throw falha(400, 'Nao e possivel denunciar o proprio perfil.');

      try {
        await executar(
          c.db,
          `insert into denuncias
             (denunciante_conta_id, denunciante_dispositivo_id,
              jogador_id, apelido_no_momento, motivo, observacao)
           values (?, ?, ?, ?, ?, ?)`,
          tipo === 'conta' ? autorId : null,
          tipo === 'dispositivo' ? autorId : null,
          jogador_id,
          alvo.apelido,
          motivo,
          observacao ?? null
        );
      } catch (e) {
        // Ja existe denuncia aberta desta pessoa sobre este alvo: responde ok,
        // para nao revelar o estado da fila nem incentivar reenvio.
        if (violouUnico(e)) return { ok: true, ja_denunciado: true };
        throw e;
      }

      console.log(JSON.stringify({ msg: 'denuncia registrada', jogador_id, motivo }));
      return { ok: true, ja_denunciado: false };
    },
  },
];
