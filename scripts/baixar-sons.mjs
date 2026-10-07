/**
 * Baixa as gravacoes dos instrumentos para sons/<amostra>/<nota>.mp3.
 *
 * So baixa as notas que o jogo realmente toca (as de cada clave liberada,
 * ja transpostas para o som real de cada instrumento), entao o peso fica no
 * minimo. Os arquivos vao para o git: o app precisa deles para funcionar
 * offline e o build nao depende de internet.
 *
 *   node scripts/baixar-sons.mjs           baixa o que falta
 *   node scripts/baixar-sons.mjs --tudo    baixa tudo de novo
 *
 * Fonte: FluidR3_GM, Creative Commons Attribution 3.0 (ver sons/CREDITOS.md).
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Instrumentos = createRequire(import.meta.url)(join(raiz, 'instrumentos.js'));

const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const refazer = process.argv.includes('--tudo');

// Arquivos unicos: varios instrumentos compartilham a mesma amostra.
const pendentes = new Map();
for (const inst of Instrumentos.LISTA) {
  for (const { amostra, nota } of Instrumentos.arquivosDo(inst.id)) {
    pendentes.set(`${amostra}/${nota}`, { amostra, nota });
  }
}

const existe = (arq) => stat(arq).then(() => true, () => false);

let baixados = 0;
let pulados = 0;
let bytes = 0;

for (const { amostra, nota } of pendentes.values()) {
  const destino = join(raiz, 'sons', amostra, `${nota}.mp3`);
  if (!refazer && (await existe(destino))) {
    pulados++;
    continue;
  }
  const url = `${BASE}/${amostra}-mp3/${nota}.mp3`;
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`ERRO ${r.status}: ${url}`);
    process.exit(1);
  }
  const dados = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, dados);
  baixados++;
  bytes += dados.length;
}

console.log(
  `${pendentes.size} gravacoes: ${baixados} baixadas (${(bytes / 1024 / 1024).toFixed(1)} MB), ${pulados} ja existiam.`
);
