# Проверка ресурсной политики Step 3

Независимое read-only рассмотрение DB-04/SYNC-02/SYNC-05 и `docs/step3-writer-design.md`: row-scaled admission с безопасным отказом допустим в существующем scope. Требование константного малого native budget для произвольного поля в ТЗ отсутствует. Поэтому прежний blocker не является основанием остановить реализацию минимального whole-field пути при явной проверке ресурсов и сохранении неполноты.

Обязательные условия reviewer: preflight до всех JSON allocations в том же source snapshot; отсутствие permanent skip/blacklist; никакого complete/sweep/cursor продвижения после resource отказа; повторное чтение того же поля при восстановлении ресурсов; bounded corpus/staging; не заявлять строгую OOM-изоляцию Worker и не использовать global heap cap для общего Extension Host.

Координатор зафиксировал политику в `docs/step3-resource-policy.md` и выполнил synthetic admission probe на minimum/current: 7/7, отказ до extraction, last-good сохранён, тот же part полностью принят при восстановлении тестового бюджета. Весь `tests/discovery` прошёл ESLint. Это Gate A engineering evidence, не production acceptance Gate B.

Остаточные риски для реализации и её тестов: freemem не резервирует память; native OOM затрагивает процесс; длительный SQLite call не прерывается мгновенно; большой INSERT/FTS update требует отдельного контроля транзакции; source snapshots нельзя удерживать после cancellation/error. Эти риски не должны быть скрыты за успешными prototype tests.
