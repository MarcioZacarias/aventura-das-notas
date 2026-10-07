#!/usr/bin/env bash
# Backup do banco. Rodar por cron no servidor:
#
#   0 3 * * * /opt/aventura-das-notas/deploy/backup.sh >> /var/log/aventura-backup.log 2>&1
#
# Um backup que nunca foi restaurado nao e um backup. Teste a restauracao:
#   gunzip -c backup.sql.gz | docker compose exec -T db psql -U aventura -d aventura

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${BACKUP_DIR:-$RAIZ/backups}"
MANTER_DIAS="${BACKUP_KEEP_DAYS:-14}"

cd "$RAIZ"
# shellcheck disable=SC1091
set -a; [ -f .env ] && . ./.env; set +a

mkdir -p "$DESTINO"
ARQUIVO="$DESTINO/aventura-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "[$(date -Is)] iniciando backup -> $ARQUIVO"
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-aventura}" \
  -d "${POSTGRES_DB:-aventura}" \
  --clean --if-exists \
  | gzip -9 > "$ARQUIVO"

TAMANHO=$(du -h "$ARQUIVO" | cut -f1)
echo "[$(date -Is)] backup concluido ($TAMANHO)"

# Um dump valido nunca tem poucos bytes; aborta antes de apagar os antigos.
if [ "$(stat -c%s "$ARQUIVO")" -lt 1000 ]; then
  echo "[$(date -Is)] ERRO: backup suspeito de vazio. Antigos preservados." >&2
  exit 1
fi

find "$DESTINO" -name 'aventura-*.sql.gz' -mtime "+$MANTER_DIAS" -delete
echo "[$(date -Is)] backups com mais de $MANTER_DIAS dias removidos"
