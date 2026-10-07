/**
 * Utilitarios HTTP: resposta JSON, erro com status e validacao de entrada.
 *
 * O validador cobre o subconjunto de JSON Schema que as rotas usam e imita o
 * comportamento do Fastify/Ajv que o servidor original tinha:
 *   - coerceTypes: "8" vira 8 em campo integer (querystring sempre chega texto)
 *   - removeAdditional: campos nao declarados sao descartados, nao rejeitados
 *   - useDefaults: aplica `default` quando o campo falta
 */

export class ErroHttp extends Error {
  constructor(status, corpo) {
    super(corpo?.erro || `HTTP ${status}`);
    this.status = status;
    this.corpo = corpo;
  }
}

/** Atalho para interromper a rota com uma resposta de erro. */
export const falha = (status, erro) => new ErroHttp(status, { erro });

export function json(corpo, status = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cabecalhos },
  });
}

const TAMANHO_MAX_CORPO = 32 * 1024;

export async function lerCorpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const texto = await req.text();
  if (new TextEncoder().encode(texto).length > TAMANHO_MAX_CORPO) {
    throw falha(413, 'Corpo da requisicao grande demais.');
  }
  if (!texto) return undefined;

  const tipo = req.headers.get('content-type') || '';
  if (!tipo.toLowerCase().includes('application/json')) {
    throw falha(415, 'Envie o corpo como application/json.');
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw falha(400, 'JSON invalido no corpo da requisicao.');
  }
}

// ------------------------------------------------------------------ validacao
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarValor(valor, schema, caminho, erros) {
  switch (schema.type) {
    case 'object': {
      if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
        erros.push(`${caminho || 'corpo'} deve ser um objeto`);
        return valor;
      }
      const saida = {};
      for (const [chave, sub] of Object.entries(schema.properties || {})) {
        let v = valor[chave];
        if (v === undefined && 'default' in sub) v = sub.default;
        if (v === undefined) {
          if (schema.required?.includes(chave)) erros.push(`${caminho}/${chave} e obrigatorio`);
          continue;
        }
        saida[chave] = validarValor(v, sub, `${caminho}/${chave}`, erros);
      }
      return saida;
    }

    case 'string': {
      if (typeof valor === 'number' || typeof valor === 'boolean') valor = String(valor);
      if (typeof valor !== 'string') {
        erros.push(`${caminho} deve ser texto`);
        return valor;
      }
      // Ajv conta caracteres Unicode, nao unidades UTF-16.
      const tamanho = Array.from(valor).length;
      if (schema.minLength !== undefined && tamanho < schema.minLength) {
        erros.push(`${caminho} deve ter pelo menos ${schema.minLength} caracteres`);
      }
      if (schema.maxLength !== undefined && tamanho > schema.maxLength) {
        erros.push(`${caminho} deve ter no maximo ${schema.maxLength} caracteres`);
      }
      if (schema.format === 'uuid') {
        if (!UUID_RE.test(valor)) erros.push(`${caminho} deve ser um uuid`);
        // O Postgres comparava uuid sem diferenciar maiusculas; aqui e texto,
        // entao normalizamos na entrada.
        else valor = valor.toLowerCase();
      }
      if (schema.enum && !schema.enum.includes(valor)) {
        erros.push(`${caminho} deve ser um de: ${schema.enum.join(', ')}`);
      }
      return valor;
    }

    case 'integer': {
      if (typeof valor === 'string' && /^\s*-?\d+\s*$/.test(valor)) valor = Number(valor);
      if (typeof valor === 'boolean') valor = valor ? 1 : 0;
      if (!Number.isInteger(valor)) {
        erros.push(`${caminho} deve ser um numero inteiro`);
        return valor;
      }
      if (schema.minimum !== undefined && valor < schema.minimum) {
        erros.push(`${caminho} deve ser >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && valor > schema.maximum) {
        erros.push(`${caminho} deve ser <= ${schema.maximum}`);
      }
      return valor;
    }

    case 'boolean': {
      if (valor === 'true' || valor === 1) valor = true;
      else if (valor === 'false' || valor === 0) valor = false;
      if (typeof valor !== 'boolean') erros.push(`${caminho} deve ser verdadeiro ou falso`);
      return valor;
    }

    default:
      return valor;
  }
}

/** Valida e normaliza `valor`. Lanca 400 com os detalhes, como o Fastify fazia. */
export function validar(valor, schema) {
  const erros = [];
  const saida = validarValor(valor, schema, '', erros);
  if (erros.length) {
    throw new ErroHttp(400, { erro: 'Dados invalidos.', detalhes: erros });
  }
  return saida;
}
