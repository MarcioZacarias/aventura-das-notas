# aventura-das-notas

Jogo para aprendizado de notas musicais.

Leitura de partitura à primeira vista: a nota entra pela direita, o jogador aperta o botão
correspondente antes que ela passe da zona de acerto. Três claves (Sol, Fá e Dó), 3 vidas,
velocidade progressiva. Áudio sintetizado em Web Audio, pauta desenhada em canvas.
Zero dependências no runtime do jogo.

## Rodar no navegador

Abra `index.html` direto, ou sirva na rede local para testar no celular:

```powershell
npm run dev     # http://<ip-da-sua-wifi>:5173
```

## App nativo (Android / iOS)

O mesmo código roda empacotado com [Capacitor](https://capacitorjs.com).

```powershell
npm install
npm run sync    # gera www/ e copia para o projeto Android
npm run apk     # APK de debug na raiz, para testar no celular
npm run aab     # AAB de release, para subir na Play Store
```

Requer JDK 21 e Android SDK — ver seção 1 de [PUBLICAR-ANDROID.md](PUBLICAR-ANDROID.md)
(nesta máquina já estão instalados em `D:\MRZ\tools\jdk-21` e `D:\MRZ\android-sdk`).

- **Publicar no Google Play:** [PUBLICAR-ANDROID.md](PUBLICAR-ANDROID.md)
- **Subir o backend no seu servidor:** [server/DEPLOY.md](server/DEPLOY.md)
- **iOS, backend único, login, histórico e amizades:** [ARQUITETURA-CROSSPLATFORM.md](ARQUITETURA-CROSSPLATFORM.md)

## Modo online

Jogo online com backend no seu próprio servidor: contas, perfis, histórico, ranking geral,
turmas e moderação.

**Login é obrigatório** (`exigirLogin: true` em `config.js`). A conta é do **responsável**
— pai, mãe ou professor — e a criança joga sob um perfil dele. A primeira execução precisa de
internet; depois disso a sessão guardada permite jogar offline.

```powershell
cp .env.example .env    # preencha POSTGRES_PASSWORD e JWT_SECRET
npm run server:up       # Postgres + API via Docker
npm test                # 149 testes (76 na API, 73 no cliente)
```

Para compilar o app apontando para o servidor:

```powershell
$env:API_BASE="https://api.seudominio.com.br"; npm run apk
```

Com login obrigatório, o build **exige** `API_BASE`. Para gerar uma versão sem login
(demonstração ou quiosque offline): `$env:EXIGIR_LOGIN="0"; npm run apk`.

### Estrutura

```
index.html                  o jogo (mantido na raiz, funciona no GitHub Pages)
game.js                     lógica, claves, áudio, canvas
config.js                   apiBase (vazio = offline); sobrescrito por API_BASE no build
api.js                      camada de rede offline-first: fila, credenciais, sync
ui-conta.js                 telas de login, perfis, progresso, ranking e turmas
scripts/dev-server.mjs      serve o jogo na rede local (testar no celular)
scripts/build-www.mjs       monta www/ com o que vai dentro do app + CSP
scripts/build-android.mjs   roda o Gradle e deixa o APK/AAB na raiz
scripts/gen-assets.mjs      gera ícones, splashes e assets da Play Store
server/                     backend: Fastify + Postgres, migrations, testes
deploy/                     Caddy (HTTPS automático), overlay de produção, backup
docker-compose.yml          banco + API
capacitor.config.json       appId br.com.aventuradasnotas.app
android/                    projeto nativo Android
store/                      ícone 512, feature graphic, ícone mestre
www/                        gerada pelo build (não versionada)
```

Os arquivos do jogo ficam na **raiz** de propósito, para o GitHub Pages continuar servindo
a versão web. O `build-www.mjs` copia só o necessário para dentro do app.

`aventura-das-notas.html` é a versão antiga em arquivo único, mantida por referência;
não entra no app.
