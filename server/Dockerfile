FROM node:24-alpine

WORKDIR /app

# Camada de dependencias separada, para aproveitar cache entre builds.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations

# Nao rodar como root.
USER node

ENV NODE_ENV=production
EXPOSE 3000

# Roda migrations e sobe a API.
CMD ["node", "src/index.js"]
