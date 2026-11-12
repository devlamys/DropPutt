#!/bin/sh
# Compressed logical backup of the dropputt database; prunes old dumps.
set -eu
stamp=$(date +%Y%m%d-%H%M%S)
out="/backups/dropputt-$stamp.sql.gz"
pg_dump --no-owner --no-privileges | gzip -9 > "$out.tmp"
mv "$out.tmp" "$out"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"
find /backups -name 'dropputt-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
