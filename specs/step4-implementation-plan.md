# План Step 4: поддержка macOS

Scope: `req/step4/01-requirements.md`. Предварительное исследование: `docs/step4-preliminary-discovery.md`. План нельзя переводить к реализации до завершения Step 3.

Актуальная исходниковая часть: [исследование по 0.3.2](../docs/step4-discovery-0.3.2.md), 22 сентября 2026 года. Source/VSIX/hash и фактические storage/search/sync contracts зафиксированы; macOS matrix M01–M12 пока без runtime evidence.

Материалы выделены в Git-ветку `step4` для публикации в `mikevisgit/KiloHub`. Основная ветка `master` сохраняет Windows baseline 0.3.2. Выделение ветки не закрывает Gate 0 и не означает выпуск поддержки macOS.

## 0. Блокирующий вход

- [ ] Step 3 завершён и выпущен.
- [x] Зафиксированы source commit, точный VSIX/SHA-256, schema/migration version Hub DB, production bundles, выбранный search stack и sync/locking/recovery contracts выпущенного Step 3 0.3.2; checksum пересчитан, отслеживаемый код сверен с release source.
- [x] Новая исходниковая часть discovery записана отдельно; выявленные расхождения с предварительным исследованием отражены в требованиях и плане.
- [ ] Предварительное исследование Step 4 полностью повторено по этому baseline на реальных `darwin-arm64` и `darwin-x64` средах.
- [ ] Новый discovery записан отдельным документом; расхождения с текущим предварительным исследованием отражены в требованиях и плане.
- [ ] Подтверждён итоговый статус Step 3: автоматическое release evidence 0.3.2 отделено от незавершённой ручной приёмки и исторических C/D checkbox.
- [ ] Поддерживаемые macOS versions, architectures, filesystem/storage/profile matrix, Rosetta policy и один platform-neutral против platform-specific packaging согласованы до production-изменений.

Gate 0: все пункты выполнены. Любое изменение Step 3, затрагивающее storage, paths, SQLite/search, worker, sync, locking, recovery или package, а также изменение поддерживаемых Kilo/VS Code/macOS/runtime/toolchain, возвращает затронутые пункты на повторное исследование. Текущий документ и `docs/step4-preliminary-discovery.md` не заменяют Gate 0.

## A. Платформенная модель

- [ ] Выделить Windows/Darwin policies для folder normalization, locality, canonical/file identity, availability и diagnostics.
- [ ] Перенести Kilo storage discovery с подтверждёнными channel/override правилами.
- [ ] Адаптировать current-folder, presentation identity и штатные команды VS Code/Finder.
- [ ] Добавить POSIX redaction и hostile path tests.
- [ ] Сохранить прежнюю Windows semantics полным regression suite.

Gate A: unit/property/integration tests доказывают обе платформенные модели без ослабления source read-only и action authorization.

## B. Hub storage и concurrency

- [ ] Реализовать подтверждённый macOS storage/profile contract Step 3.
- [ ] Защитить source Kilo DB от Hub migrations/FTS/cleanup по canonical path и file identity.
- [ ] Проверить migrations, multi-window writer, stale owner, crash, disk full, rebuild и atomic switch на APFS.
- [ ] Проверить POSIX GC открытого поколения/WAL/SHM, crash вокруг pointer rename, права sidecars/temp files и границы durability; IPC stale endpoint/длина/permissions проверяются для выбранного механизма.
- [ ] Проверить отсутствие corpus в Settings Sync, логах, Webview и package.

Gate B: ни одна writable операция не достигает Kilo; последний корректный индекс восстанавливается или сохраняется при всех проверенных сбоях.

## C. Runtime, sync и поиск

- [ ] Проверить Worker/SQLite/WAL/FTS или фактически выбранный Step 3 stack в minimum/current VS Code на обеих архитектурах.
- [ ] Проверить initial import, polling, reconciliation, source replacement, sleep/wake и shutdown без открытой панели.
- [ ] Повторить correctness/security/performance corpus и budgets Step 3 на обеих архитектурах.
- [ ] Проверить несколько окон и профилей в соответствии с утверждённым storage contract.

Gate C: функциональная семантика Step 3 сохранена, Windows не регрессировал, background runtime не блокирует Extension Host и не переживает закрытие VS Code.

## D. UI и системная интеграция

- [ ] Проверить Finder, folder picker и действия открытия.
- [ ] Проверить keyboard, focus, VoiceOver, темы, forced colors, zoom и responsive widths.
- [ ] Записать ручную матрицу отдельно для native arm64/x64; Rosetta только при заявленной поддержке.

Gate D: ручная и автоматическая приёмка не содержит открытых Blocker/High; ограничения явно записаны.

## E. Packaging и выпуск

- [ ] Сделать cross-platform exact/negative verifier без обязательной зависимости от PowerShell на macOS.
- [ ] Собрать утверждённый Gate 0 набор: один platform-neutral VSIX либо отдельные `darwin-arm64` и `darwin-x64` VSIX; выполнить два clean cycles каждого выпускаемого артефакта.
- [ ] Выполнить isolated installed minimum/current tests без системных Node.js/npm/SQLite/Kilo CLI.
- [ ] Провести независимое source/security/package review и исправить findings с повторной проверкой.
- [ ] Записать source commit, target, путь, размер, SHA-256, runtime matrix и ограничения каждого артефакта в `handoff.md`.

Gate E: утверждённый артефакт установлен и проверен отдельно в обеих нативных архитектурах; при platform-specific стратегии оба артефакта прошли exact package gate. Windows Step 3 artifact/regression остаётся поддерживаемым. Rosetta не заявляется без отдельного evidence.

Статус: исходниковая часть Gate 0 обновлена по выпущенному 0.3.2. Gate 0 остаётся открыт: нативные M01–M12, итоговая приёмка Step 3 и согласование платформенных решений не завершены. Production этапы A–E не начаты.
