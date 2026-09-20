# Трассировка приёмки Step 1

## Статус

Production-код, unit/Extension Host tests, независимые ревью, remediation и release gate завершены. Worker-enabled VSIX воспроизводимо собран, exact-проверен и установлен в изолированные VS Code `1.105.1` и Stable `1.138.0`.

## Acceptance Criteria

| AC | Реализация и автоматическое доказательство | Остаточный gate | Статус |
|---|---|---|---|
| AC-1. Установка | Clean package, exact verify и installed Extension Host smoke прошли на `1.105.1`; isolated Stable install/list также прошёл. | Нет. | Пройдено |
| AC-2. Папка с активностью | Metadata adapter, projection и provider реализованы; 31 live root session успешно читается. | Installed view smoke. | Реализовано |
| AC-3. Папка без активности | Folder создаётся только из непустой группы валидных sessions; unit tests проходят. | Installed view smoke с контрольной папкой. | Реализовано |
| AC-4. Titles и детали | Tree contract проверяет path, три actions и passive conversation в точном порядке. | Визуальный smoke длинного/non-ASCII title. | Реализовано |
| AC-5. Группировка | Case-insensitive identity и deterministic display candidate покрыты reorder test. | Нет. | Пройдено автоматически |
| AC-6. Refresh | Fresh worker/connection, in-flight dedupe и атомарная замена модели реализованы. Ошибка сохраняет предыдущие folders. | Визуальный create/rename/delete/recovery smoke. | Реализовано |
| AC-7. Open Here | Используется `vscode.openFolder(uri, { forceReuseWindow: true })`; option contract проверен. | Изолированный реальный переход окна. | Реализовано |
| AC-8. Open in New Window | Используется `vscode.openFolder(uri, { forceNewWindow: true })`; option contract проверен. | Изолированное реальное новое окно. | Реализовано |
| AC-9. Missing folder | Folder сохраняется, warning icon/tooltip видимы, actions не получают command. | Визуальный installed smoke. | Реализовано |
| AC-10. Read-only | `readOnly`, `query_only`, отсутствие write SQL, WAL visibility, DB/WAL fingerprints, busy/error и worker isolation проверены в source и packaged runtime. | Нет. | Пройдено |
| AC-11. Нет registry | Storage API/Hub DB/add-remove-hide commands отсутствуют; exact manifest ограничен четырьмя командами. | Package inspection нового VSIX. | Реализовано |
| AC-12. Explorer | Повторная local-directory проверка и `vscode.env.openExternal(fileUri)` реализованы. | Реальный Explorer smoke. | Реализовано |
| AC-13. Фильтрация | SQL исключает child/archive; projection исключает UNC/remote/`.code-workspace`/invalid. `realpath` исключает resolved UNC. | Нет. | Пройдено автоматически |
| AC-14. Fallback и sorting | `Без названия`, warning, timestamps и deterministic tie-break покрыты unit tests. | Визуальный Output/view smoke. | Реализовано |
| AC-15. Ошибка чтения | Error message/Output/retry и сохранение предыдущей модели реализованы; refresh command теперь reject при runtime failure. | Installed failure/recovery smoke. | Реализовано |

## Definition of Done

| Проверка | Доказательство | Статус |
|---|---|---|
| Kilo source/schema задокументированы | `docs/kilo-storage-discovery.md`; live schema и CLI oracle | Пройдено |
| SQL adapter совпадает с Kilo | SQL/CLI: 31/31 root sessions без расхождений | Пройдено |
| Runtime packaged и работает при WAL | Development и installed Extension Host proofs пройдены | Пройдено |
| Только supported paths | Unit tests и resolved local path checks | Пройдено |
| Группировка и ordering | Projection suite, включая reorder и 1 000 sessions | Пройдено |
| Refresh без restart | Код и command activation проверены; installed transition smoke ожидается | Открыто |
| Missing state | Provider contract пройден; visual smoke ожидается | Открыто |
| Unit/integration tests | `npm test`: 27 tests + VS Code `1.105.1`, exit `0` | Пройдено |
| Compile/lint | `npm run check-types`, `npm run lint` | Пройдено |
| Reproducible VSIX | Две clean сборки: одинаковый SHA-256 `13AC1501...F67743` | Пройдено |
| Чистая установка VSIX | Изолированные `user-data`/`extensions`, minimum host и Stable | Пройдено |
| Ручной smoke трёх действий | Не выполнен на новом пакете | Открыто |
| Разные Kilo states | Fixtures/live probe покрывают rows; visual transitions ожидаются | Частично |
| CLI не нужен runtime | Production imports/VSIX не содержат CLI | Пройдено |
| Нет Kilo storage writes | Static SQL review и SQLite tests | Пройдено |
| Нет summary/LLM/message search | Static/package review | Пройдено |
| Ограничения release notes | `docs/release-notes.md` | Пройдено |

## Исключённый Scope

| Исключение | Контроль |
|---|---|
| `.code-workspace`, multi-root, UNC, remote URI | Normalization tests и отсутствие соответствующих branches открытия |
| Open Recent, legacy task JSON | Импорты/API отсутствуют |
| Ручной registry/add/remove/hide | Storage отсутствует, commands exact-checked |
| Conversation deep link | Conversation nodes passive |
| Summary, LLM, embeddings, message search | SQL выбирает только семь session metadata columns |
| Project file indexing | Выполняется только bounded `stat/realpath` folder path |
| Watcher/auto refresh | File watcher/timer refresh отсутствуют |
| API/MCP/telemetry/cloud | Contributions, imports и runtime dependencies отсутствуют |

## Остаточный ручной smoke

Release blocker отсутствует. Остаётся эксплуатационный визуальный клик-тест `Open Here`, `Open in New Window`, `Open in File Explorer` в disposable GUI. Installed automation намеренно не заменяет workspace и не создаёт внешние окна; command wiring, internal references, повторная local-directory проверка и exact API options проверены кодом/tests.
