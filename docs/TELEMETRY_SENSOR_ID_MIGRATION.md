# План выравнивания sensorId для device-001

## Результат аудита 2026-09-21

Исторические measurements `device-001` за UTC-день 2026-09-19 не содержали
`sensorId`. Read-модель предсказуемо нормализовала их как `default`. Это тот же
единственный физический DS18B20, который текущая прошивка отправляет как
`temperature-1`.

Read-only снимок production read-модели:

| Коллекция | `default` | `temperature-1` |
| --- | ---: | ---: |
| `points` | 360 | 2 570 |
| `rollups` | 6 | 23 |

Шесть `default` rollup-документов относятся только к 2026-09-19 UTC.
Внутри scope 360 timed points, 0 unplaced points, и `N/min/max/avg` совпадают
с legacy: `360 / 24.88 / 25.06 / 24.9661666667`.

## Что делает UI сейчас и что будет после PR B

Текущий CRM-график пока читает legacy
`monitoringTelemetry/{deviceId}/packets` и вообще не использует `sensorId`.
Поэтому этот historical split пока не отображается.

Архитектура PR B должна читать raw `points` и overview `rollups` по точному
`sensorId`: rollup ID уже содержит sensor (`{sensorId}__{hourStartMs}`). Без
alias-слоя или миграции `default` и `temperature-1` станут двумя независимыми
сериями. Для `device-001` выбран вариант ограниченной миграции уже созданного
scope к каноническому `temperature-1`; legacy `packets` остаются неизменными.

## Предлагаемая миграция — пока не выполнять

**Scope только:** `device-001`, `2026-09-19T00:00:00Z` —
`2026-09-20T00:00:00Z`, `default` → `temperature-1`.

1. Новый доверенный Admin-tool начинает с dry-run. Он сканирует legacy по
   `measuredAt` (не по `receivedAt`), строит manifest из
   `stableMeasurementId(packetId, measurementIndex)` и требует ровно 360 IDs,
   0 unplaced, 6 source-rollups. Также он требует, чтобы в этом окне не было
   target `temperature-1` points/rollups. Иное состояние — отказ до записи.
2. Execute хранит собственный checkpoint в
   `monitoringMaintenance/telemetrySensorIdMigration/checkpoints/`
   `device-001__2026-09-19__default-to-temperature-1` и обрабатывает одну
   часовую группу за транзакцию, с ограничением скорости. Он не использует
   старый checkpoint backfill.
3. В транзакции одной часовой группы tool читает все её deterministic point
   docs, source `default` rollup и target rollup. Он проверяет полный manifest,
   source/target preconditions и отсутствие частичного состояния. Затем
   обновляет только поле `sensorId` существующих point docs — document ID не
   меняется, поэтому второй point не появляется. Source rollup копируется в
   target с теми же buckets/quality aggregates, `sensorId: temperature-1` и
   `migrationId`; source rollup удаляется в той же транзакции. Таким образом
   одна точка и один час имеют ровно один sensor-series.
4. Resume допускается только для часа, уже помеченного тем же `migrationId` и
   полностью переведённого в target. Комбинация source+target, отсутствующий
   point или чужой target rollup является ошибкой и требует ручного разбора;
   tool не пересчитывает и не суммирует rollup «на глаз».

Перед execute обязателен новый dry-run непосредственно перед запуском: он
защищает от позднего старого пакета или другой записи в историческое окно.
Execute не запускается, пока target scope не пуст и manifest не совпадает.

## Verify и rollback

После execute — только read-only verify:

- legacy остаётся неизменным и, с alias `default -> temperature-1` только для
  этого manifest, совпадает с target по `N/min/max/avg`;
- ровно 360 `temperature-1` points и 0 `default` points в scope;
- ровно 6 `temperature-1` rollups и 0 `default` rollups в scope;
- все 360 stable IDs сохранены, а суммы/count каждой 5-минутной quality bucket
  совпадают с предмиграционным source snapshot;
- повторный dry-run сообщает 0 планируемых point/rollup изменений.

Rollback доступен до удаления raw points TTL: отдельный явный Admin-tool
работает теми же часовыми транзакциями в обратную сторону, но только если
каждая target point/rollup несёт ожидаемый `migrationId`, source отсутствует и
послемиграционный manifest совпадает. Он восстанавливает source rollup из
target, возвращает point `sensorId: default`, затем удаляет target. Legacy
packets не меняются ни при migration, ни при rollback. Любое иное состояние
останавливает rollback без частичного «исправления».

## До отдельного разрешения

Не выполнять dry-run/execute/rollback против production, не публиковать
Functions, Rules или indexes и не менять VPS, firmware, UI, ключи или env.
