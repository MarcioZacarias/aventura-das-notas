/**
 * Roda o Gradle e deixa o binario pronto na raiz do projeto.
 *
 *   node scripts/build-android.mjs debug     -> APK de debug (testar no celular)
 *   node scripts/build-android.mjs release   -> AAB de release (subir na Play Store)
 *
 * Feito em Node em vez de shell porque `cd android && gradlew.bat` nao resolve
 * de forma confiavel dentro de npm scripts no Windows.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const mode = (process.argv[2] || 'debug').toLowerCase();

if (!['debug', 'release'].includes(mode)) {
  console.error(`Modo invalido: "${mode}". Use "debug" ou "release".`);
  process.exit(1);
}

const isWin = process.platform === 'win32';
const gradlew = join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');

const TARGETS = {
  debug: {
    task: 'assembleDebug',
    out: join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    dest: join(root, 'AventuraDasNotas-debug.apk'),
  },
  release: {
    task: 'bundleRelease',
    out: join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
    dest: join(root, 'AventuraDasNotas-release.aab'),
  },
};
const { task, out, dest } = TARGETS[mode];

// O Gradle 8.11.1 suporta Java 17-23. Se o JAVA_HOME apontar para algo fora
// disso (esta maquina tem Java 26 no Path), avisa antes de gastar minutos no build.
const javaHome = process.env.JAVA_HOME;
if (!javaHome) {
  console.warn(
    'AVISO: JAVA_HOME nao esta definido. O Gradle vai usar o java do Path,\n' +
      '       que pode ser uma versao incompativel. Esperado: JDK 21.\n'
  );
}

console.log(`\n> gradlew ${task}  (em ${androidDir})\n`);
// No Windows um .bat nao e executavel direto pelo spawn; invocamos via cmd /c em
// vez de usar shell:true, que dispara aviso de depreciacao do Node por nao
// escapar os argumentos.
const [cmd, cmdArgs] = isWin
  ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', gradlew, task]]
  : [gradlew, [task]];
const res = spawnSync(cmd, cmdArgs, { cwd: androidDir, stdio: 'inherit' });

if (res.status !== 0) {
  console.error(`\nFalhou: gradlew ${task} saiu com codigo ${res.status}.`);
  process.exit(res.status ?? 1);
}

if (!existsSync(out)) {
  console.error(`\nBuild terminou mas o arquivo esperado nao existe:\n  ${out}`);
  process.exit(1);
}

copyFileSync(out, dest);
const mb = (statSync(dest).size / 1024 / 1024).toFixed(2);
console.log(`\nPronto: ${dest}  (${mb} MB)`);

if (mode === 'debug') {
  console.log('\nInstalar no celular:');
  console.log('  sem cabo -> com `npm run dev` rodando, baixe pelo Chrome do celular:');
  console.log('              http://<ip-da-wifi>:5173/AventuraDasNotas-debug.apk');
  console.log('  com USB  -> adb install -r AventuraDasNotas-debug.apk');
} else {
  console.log('\nEste AAB e o que sobe na Play Console.');
  console.log('Confirme que android/keystore.properties existe, senao ele sai sem assinatura.');
}
