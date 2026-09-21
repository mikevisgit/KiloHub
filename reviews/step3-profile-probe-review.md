# Ревью profile discovery probe

Независимое read-only review `tests/discovery/run-profile-probe.mjs` и `tests/discovery/profile-probe/` от 21 сентября 2026 года: actionable findings отсутствуют.

Проверены изоляция временного user-data/extensions root, guard до записи marker, onStartupFinished без принудительного activate(), сравнение marker/URI разных профилей и user-data roots. Результат не распространяется на все виды profile storage, installed VSIX или одновременных writers. Выбор профиля запрашивается CLI, отдельная проверка внутреннего profile ID не выполнялась. Реализация prepareIsolatedTestHost была вне области независимого review; координатор отдельно прочитал helper, который временно меняет и восстанавливает только cached test product.json.

Runtime minimum/current probes пройдены. Полный baseline npm test после добавления discovery: typecheck/lint, 62 unit, 29 component, bundle scan и minimum Extension Host PASS. Реальные Kilo data не читались.
