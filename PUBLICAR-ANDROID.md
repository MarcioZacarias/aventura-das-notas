# Publicar "Aventura das Notas" na Google Play Store

Estado atual do repositório: **projeto Android nativo pronto e configurado**.
Falta instalar o toolchain de build (Android Studio) e executar os passos de conta/loja,
que exigem sua identidade e cartão.

- Application ID: `br.com.aventuradasnotas.app` (**permanente** — não muda depois de publicado)
- Nome exibido: `Aventura das Notas`
- versionCode `1` / versionName `1.0.0`
- targetSdk 35, minSdk 23 (cobre Android 6.0+)
- Orientação travada em retrato

---

## 1. Toolchain — já instalado ✅

O build de release **já roda nesta máquina**. Instalado em:

| Item | Versão | Caminho |
|---|---|---|
| JDK (Eclipse Temurin) | 21.0.12 LTS | `D:\MRZ\tools\jdk-21` |
| Android SDK cmdline-tools | 22.0 | `D:\MRZ\android-sdk\cmdline-tools\latest` |
| Android platform | API 35 | `D:\MRZ\android-sdk\platforms\android-35` |
| Build-tools | 35.0.0 | `D:\MRZ\android-sdk\build-tools\35.0.0` |
| platform-tools (`adb`) | — | `D:\MRZ\android-sdk\platform-tools` |

Variáveis de usuário já gravadas (`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`), e
`platform-tools` + `jdk-21\bin` adicionados ao `Path`. **Abra um terminal novo** para que valham.

O caminho do SDK está em `android/local.properties` (não versionado).

> O Java 26 que existe no `Path` do sistema **não serve** para build Android — o Gradle 8.11.1
> suporta até Java 23. Por isso o `JAVA_HOME` aponta para o JDK 21. Se `gradlew` reclamar de
> "Unsupported class file major version", é o `JAVA_HOME` apontando para o lugar errado.

Não foi instalado Android Studio (não é necessário para compilar). Se quiser IDE, emulador e
Logcat depois, instale por cima — ele reaproveita este mesmo SDK apontando `ANDROID_HOME`.

---

## 2. Testar no celular

### Opção A — jogo no navegador, pela rede local (mais rápido, sem cabo)

```powershell
npm run dev
```

Abre em `http://<ip-da-sua-wifi>:5173`. No celular (mesmo Wi-Fi), abra essa URL no Chrome e use
**"Adicionar à tela inicial"**: o `index.html` já declara `mobile-web-app-capable`, então roda
em modo standalone, sem barra do navegador — bem próximo do app real.

Cobre canvas, áudio, toque, layout e os glifos das claves. **Não** cobre splash nativa, ícone,
trava de orientação nem botão voltar.

### Opção B — instalar o APK de verdade

```powershell
npm run apk
```

Gera `AventuraDasNotas-debug.apk` na raiz do projeto (~3,8 MB). Para instalar:

**Sem cabo** — com `npm run dev` rodando, abra no Chrome do celular:
`http://<ip-da-sua-wifi>:5173/AventuraDasNotas-debug.apk`
O Chrome baixa e oferece instalar. Será preciso permitir "instalar apps de fontes desconhecidas"
para o Chrome (o Android pergunta na hora).

**Com cabo USB** — ative *Opções do desenvolvedor* → *Depuração USB* no celular, conecte e:

```powershell
adb devices          # confirme que o aparelho aparece e autorize o prompt na tela
adb install -r AventuraDasNotas-debug.apk
adb logcat -s Capacitor:V chromium:V   # ver erros de JS/WebView
```

> O APK de **debug** é assinado com a chave de debug automática — serve para testar, mas
> não pode ir para a Play Store. Para isso é o `bundleRelease` da seção 4.

### Checklist de teste manual (o jogo é canvas + Web Audio, vale conferir no aparelho real):
- [ ] Áudio toca (Web Audio às vezes precisa de interação — o jogo já chama `getAudioCtx()` no clique da clave)
- [ ] As 3 claves (Sol, Fá, Dó) funcionam
- [ ] Botão de mudo
- [ ] Símbolos de clave `𝄞 𝄢 𝄡` aparecem — **atenção**: são glifos musicais Unicode e podem sair como
      "caixinha" (tofu) em Android sem fonte musical. Ver seção 6.
- [ ] Layout respeita notch e barra de navegação
- [ ] Botão "voltar" do Android não fecha o app no meio da partida

---

## 3. Gerar a keystore de upload

**Este é o passo mais crítico e irreversível do processo.** Se você perder essa chave,
não consegue mais publicar atualizações do app (só resolve abrindo ticket no suporte do Google).

```powershell
# Crie a pasta FORA do repositório
New-Item -ItemType Directory -Force "D:\MRZ\chaves"

& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v `
  -keystore "D:\MRZ\chaves\upload-keystore.jks" `
  -alias upload `
  -keyalg RSA -keysize 4096 -validity 10000 `
  -storetype PKCS12
```

O `keytool` vai pedir uma senha e alguns dados (nome, organização, país `BR`).

Depois:

```powershell
Copy-Item android\keystore.properties.example android\keystore.properties
```

Edite `android/keystore.properties` com o caminho e as senhas reais.

**Backup obrigatório**, em pelo menos dois lugares seguros:
- o arquivo `upload-keystore.jks`
- as senhas (`storePassword`, `keyPassword`) e o `keyAlias`

Guarde em gerenciador de senhas / cofre. `*.jks` e `keystore.properties` já estão no `.gitignore` —
**nunca** comite nenhum dos dois.

---

## 4. Gerar o AAB de release

A Play Store exige **Android App Bundle (`.aab`)**, não APK.

```powershell
cd android
.\gradlew.bat bundleRelease
```

Saída: `android/app/build/outputs/bundle/release/app-release.aab`

Para testar o binário assinado num aparelho antes de subir (opcional, recomendado):

```powershell
# APK universal a partir do AAB, usando bundletool
# https://github.com/google/bundletool/releases
java -jar bundletool.jar build-apks --bundle=app\build\outputs\bundle\release\app-release.aab `
  --output=app-release.apks --mode=universal
```

---

## 5. Play Console

### 5.1 Conta de desenvolvedor
- Taxa de **US$ 25, uma vez só** (vitalícia): https://play.google.com/console/signup
- Verificação de identidade obrigatória. Conta de **empresa** exige número D-U-N-S e leva mais tempo.
- Decida agora: conta **pessoal** ou **empresa**. Isso muda o passo 5.2.

### 5.2 ⚠️ Teste fechado obrigatório (contas pessoais)

Contas **pessoais** criadas depois de 13/11/2023 precisam, antes de liberar produção:
- rodar um **teste fechado** com no mínimo **12 testadores** que aceitem o convite,
- mantidos ativos por **14 dias consecutivos**,
- e só então solicitar acesso à produção.

Isso significa que **a publicação leva pelo menos 2 semanas** depois do app pronto. Planeje isso.
Contas de **empresa/organização** são isentas dessa exigência.
Confirme os números atuais no próprio Console — o Google ajusta essa política periodicamente.

### 5.3 Ficha da loja

Assets já gerados em [store/](store/):
- `play-icon-512.png` — ícone 512×512, PNG 32-bit sem transparência ✅
- `play-feature-graphic-1024x500.png` — feature graphic ✅
- `icon-master-1024.png` — mestre, caso queira reeditar

**Falta você produzir:** no mínimo **2 screenshots de celular** (a Play não aceita menos).
Capture direto do emulador ou aparelho: tela de escolha de clave, partida em andamento, tela final.
Aceitos: 9:16 ou 16:9, lado menor entre 320px e 3840px.

Textos a escrever:
- **Título** (máx. 30 caracteres): `Aventura das Notas`
- **Descrição curta** (máx. 80): ex. `Aprenda a ler notas musicais brincando. Clave de Sol, Fá e Dó.`
- **Descrição completa** (máx. 4000): como jogar, as 3 claves, progressão de nível, para quem serve
  (alunos de violino/música), que funciona offline e sem anúncios.
- **Categoria**: Jogos → Educativo
- **Tags**: música, educação, infantil

### 5.4 Declarações obrigatórias no Console

| Formulário | Resposta para a v1.0 (jogo offline) |
|---|---|
| Classificação de conteúdo (IARC) | Questionário → deve sair **Livre / 3+** |
| Segurança dos dados (Data safety) | ⚠️ Agora **há** coleta: e-mail e nome do responsável (conta), apelido e histórico de partidas. Declare tudo. |
| Anúncios | **Não contém anúncios** |
| Acesso ao app | ⚠️ **Login obrigatório** — ver 5.4.1 abaixo |
| Público-alvo e conteúdo | Ver aviso abaixo ⚠️ |
| Política de privacidade | **URL obrigatória** (ver abaixo) |

### 5.4.1 ⚠️ Credenciais de teste (obrigatório, com login exigido)

O app agora **não permite jogar sem login**. Isso torna obrigatório preencher o formulário
**"Acesso ao app"** na Play Console com credenciais de teste funcionais:

1. Play Console → seu app → **Política** → **Acesso ao app**
2. Escolha *"Todas ou algumas funcionalidades são restritas"*
3. Adicione uma instrução com **e-mail e senha de uma conta real** do seu servidor

Sem isso o revisor do Google trava na tela de login e a submissão é **recusada** — é uma das
causas mais comuns de rejeição em app com autenticação.

Crie uma conta dedicada à revisão (ex.: `revisao@seudominio.com.br`), com dados de brincadeira,
e **não a apague** entre versões.

Vale também lembrar: com login obrigatório, o **servidor precisa estar no ar** para o app
funcionar. Se a API cair, ninguém novo consegue entrar. Monitore `/health`.

### 5.5 ⚠️ Política de Famílias — leia antes de marcar o público-alvo

Se você declarar que o público-alvo **inclui crianças** (o que é o caso natural de um jogo
de aprendizado musical infantil), o app entra na **Política de Famílias** do Google Play, que impõe:

- **Política de privacidade obrigatória**, com URL pública e acessível (mesmo sem coletar dados).
- Proibição de coletar dados pessoais de crianças sem consentimento verificável dos pais.
- Se houver anúncios: apenas SDKs certificados para Famílias.
- Sem APIs de publicidade/analytics que coletem identificadores de publicidade (AAID).

Para a **v1.0 offline isso é tranquilo** — o app não coleta nada. Basta publicar uma política de
privacidade simples (dá para hospedar de graça no GitHub Pages deste próprio repositório).

**Mas** os recursos que você quer adicionar depois — login, histórico, amizades entre jogadores —
mudam completamente esse cenário. Ver [ARQUITETURA-CROSSPLATFORM.md](ARQUITETURA-CROSSPLATFORM.md),
seção de conformidade.

### 5.6 Fluxo de subida

1. Play Console → **Criar app**
2. Preencher ficha da loja + todas as declarações da seção 5.4
3. **Assinatura de apps do Google Play**: aceite (recomendado). Você sobe com a chave de *upload*;
   o Google reassina com a chave de *assinatura* que ele guarda. É o que protege você caso perca a keystore.
4. Testes → **Teste fechado** → subir o `.aab` → convidar os 12+ testadores
5. Depois dos 14 dias → **solicitar acesso à produção**
6. Produção → lançamento → revisão do Google (dias a algumas semanas na primeira vez)

---

## 6. Pendências técnicas conhecidas

Coisas que valem resolver antes ou logo depois do lançamento:

1. **Glifos de clave podem não renderizar.** `index.html` e `game.js` desenham `𝄞 𝄢 𝄡` com fallback
   `'Bravura Text', 'Noto Music', 'Apple Symbols', serif`. Nenhuma dessas fontes existe por padrão no
   Android — há risco real de aparecer caixinha vazia. **Correção recomendada:** embutir a fonte
   [Bravura](https://github.com/steinbergmedia/bravura) (SIL OFL, uso livre) em `www/`, ou desenhar as
   claves como `Path2D` no canvas. Teste no aparelho antes de publicar.
2. **Sem persistência de recorde.** O jogo zera tudo ao fechar. Um recorde local em `localStorage`
   é barato e melhora muito a retenção — e é o primeiro degrau para o histórico do backend.
3. **targetSdk 36 (Android 16).** Hoje 35 é aceito. O Google costuma exigir o nível mais recente a
   partir de 31 de agosto de cada ano, então a virada para 36 é iminente. Quando for fazer:
   `android/variables.gradle` → `compileSdkVersion`/`targetSdkVersion` = 36, **e** subir o AGP
   (`android/build.gradle`, hoje `8.7.2` → 8.9+, que é o mínimo para compileSdk 36).
   Atenção: a API 36 força *edge-to-edge*; o CSS já usa `env(safe-area-inset-*)` e `viewport-fit=cover`,
   mas **teste o layout** depois de subir.
4. **Botão voltar do Android.** Hoje fecha o app. O ideal é interceptar e pausar/confirmar durante a partida.

---

## Comandos de referência

```powershell
npm run build          # gera www/ a partir dos arquivos da raiz
npm run sync           # build + copia para o Android
npm run open:android   # abre no Android Studio
node scripts/gen-assets.mjs   # regenera todos os ícones e splashes

cd android
.\gradlew.bat assembleDebug    # APK de debug
.\gradlew.bat bundleRelease    # AAB de release (assinado, se keystore.properties existir)
```

## Atualizações futuras

Toda subida nova para a Play precisa de `versionCode` **maior** que o anterior.
Em `android/app/build.gradle`:

```gradle
versionCode 2
versionName "1.1.0"
```
