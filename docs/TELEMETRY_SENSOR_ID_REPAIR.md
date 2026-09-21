# Repair sensorId read-модели: `device-001`, 2026-09-19 UTC

Инструмент предназначен только для единственного физического DS18B20
`device-001`: старый legacy `default` равен нынешнему `temperature-1`. Он не
является Cloud Function и не изменяет legacy packets.

## Обычный backfill

`canonicalBackfillSensorId()` сопоставляет legacy `default` с `temperature-1`
только для `device-001`. Поэтому следующий backfill не создаст новую
read-model series `default`; другие устройства сохраняют свои sensorId.

## Repair созданного scope

`functions/scripts/repair-monitoring-sensor-id.js` ограничен жёстко:
`device-001`, один UTC-день, `default -> temperature-1`. Dry-run является
значением по умолчанию. Перед любой записью строится legacy manifest по
`measuredAt`: ровно 360 timed IDs, 0 unplaced и 6 hour-rollups; смешанное
source/target состояние отклоняется.

```powershell
# План без записи.
npm --prefix functions run repair:monitoring-sensor-id -- --project coolservice-crm --device-id device-001 --utc-day 2026-09-19

# Только после отдельного разрешения: checkpoint и throttling.
npm --prefix functions run repair:monitoring-sensor-id -- --project coolservice-crm --device-id device-001 --utc-day 2026-09-19 --execute --confirm-scope device-001:2026-09-19 --rate-per-minute 30

# Read-only verify после execute.
npm --prefix functions run verify:monitoring-sensor-id-repair -- --project coolservice-crm --device-id device-001 --utc-day 2026-09-19
```

Checkpoint независим от backfill:
`monitoringMaintenance/telemetrySensorIdMigration/checkpoints/`
`device-001__2026-09-19__default-to-temperature-1`.

Одна часовая transaction обновляет `sensorId` существующих deterministic point
documents; IDs не меняются, поэтому points не дублируются. В той же transaction
source rollup переносится в target с теми же 5-minute buckets и quality
aggregates, после чего source удаляется. Любое частичное или чужое состояние
останавливает инструмент без пересчёта count/sum.

Verifier после repair обязан показать `default=0 points/0 rollups`,
`temperature-1=360 points/6 rollups` и совпадение legacy/new N/min/max/avg.

## Rollback

Tool поддерживает rollback dry-run (`--rollback`) и explicit rollback
(`--rollback --execute --confirm-scope ...`). Он разрешён только если target
points/rollups несут ожидаемый `sensorIdMigrationId`, source отсутствует и
manifest полный. Rollback возвращает `sensorId: default`, переносит rollup
обратно и удаляет target в тех же часовых transactions. Legacy packets не
меняются. Перед реальным rollback требуется отдельное подтверждение.

Ни dry-run, ни execute не публикуют Functions/Rules/indexes и не меняют VPS,
firmware, ключи или env.
