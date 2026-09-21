# Step 3: ресурсная политика Gate A

## Решение

Независимая проверка DB-04/SYNC-02/SYNC-05 установила: ТЗ не требует константного малого native memory bound независимо от размера поля. Прежняя трактовка такого предела как обязательного продуктового условия была избыточной. Выбирается bounded corpus processing и row-scaled admission без постоянного лимита истории или пропуска реплик. Стек и поисковая семантика не меняются.

До любых JSON-функций в согласованном source read snapshot читать `octet_length(data)` голого столбца. Проверять размер отдельно для message/part JSON. Обрабатывать одно поле за раз: BLOB extraction (сохраняет NUL на minimum), UTF-8 decoding и whole-string NFC/lower/ё→е/NFC. Не накапливать весь корпус в JS и не переносить raw JSON в Hub.

Начальная модель admission: estimate = 64 MiB + 16 × source JSON bytes; estimate не должен превышать min(freemem/4, V8 heap headroom/2); source bytes должны помещаться в runtime string/buffer limits с резервом для нормализации (string limit / 3). Это консервативная инженерная оценка по измерениям, **не резервирование памяти и не доказанная изоляция от native OOM**. Она проверяется заново при каждой попытке. Не применять global SQLite heap limit в общем Extension Host.

При отказе: закрыть snapshot, rollback неполной публикации, не продвигать подтверждённый cursor, не sweep/delete, сохранить last-good и incomplete/stale, повторить с backoff. Поле не заносится в blacklist и не считается импортированным. Другая доступность ресурсов может позволить импортировать то же поле позже. Нет постоянного максимального размера реплики как продуктового фильтра; ограничения runtime/ресурсов отражаются ошибкой, аналогично disk-full.

## Бюджеты реализации

- Poll: 10 секунд, без перекрытия циклов; полная reconciliation минимум раз в 5 минут после завершения предыдущей, изменения source sequence обрабатываются раньше.
- Справочные metadata batches: до 100 строк; text normalization по одной строке с admission.
- Hub staging batches: ориентир 256 KiB или 100 строк; крупное отдельное нормализованное поле обрабатывается отдельно, без усечения/публикации неполного значения. Длительная native операция в worker не удерживает source/Hub write lock без необходимости.
- Cooperative batch target: 100 ms для небольших полей, не hard deadline для любого поля. Большие строки могут занимать больше, измерены 12 MiB за ~0.4 s. Между полями yield/cancellation/token check обязательны.
- Busy timeout: 80 ms, фактический вызов может занимать ~160 ms; retries вне транзакции.
- Backoff ошибок: от 10 секунд до 5 минут; обычная свежесть цель ~20 секунд при idle worker/доступном источнике, не гарантия при backlog или больших полях.
- Все большие операции вне Extension Host event loop; native allocation остаётся в общем процессе. Lifetime watchdog не объявляется мгновенным SQLite interrupt.
- Writer: независимый эксклюзивный Windows named pipe по physical storage identity для recovery и SQL generation/token внутри транзакции. Не заменять coordination store по одному heartbeat. Владение должно охватывать чтение большого поля, чтобы несколько претендентов не выделяли память одновременно.

## Evidence и границы

`tests/discovery/step3-resource-admission.cjs`: 7/7 на bundled minimum/current, отказ до JSON extraction, last-good/cursor сохранены, то же поле полностью обработано при восстановлении тестового memory budget; Unicode/NUL сохранены. Это injected admission, не настоящий OOM. Предыдущие JSON/corpus, disk/WAL, profile/startup, fence и pipe probes остаются evidence возможностей primitives.

Gate A для начала реализации закрывается по совокупности измерений и определённого fail-safe контракта. Реальные production tests полного importer, recovery, concurrent windows и byte budgets относятся к Gate B и обязаны пройти до поиска/выпуска. Закрытие discovery не означает, что готовый Step 3 уже проверен, и не разрешает скрывать ошибки или пропускать части истории.
