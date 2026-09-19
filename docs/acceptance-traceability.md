# Трассировка приёмки Step 1

## Назначение и правила статусов

Документ связывает критерии приёмки и Definition of Done из `req/step1/04-preparation-and-acceptance.md` с текущими реализацией, проверкой и доказательствами. Источниками границ продукта также служат `req/step1/01-requirements.md`, `req/step1/02-discovery.md`, `req/step1/03-technical-plan.md`, `req/step1/README.md`, `specs/step1-implementation-plan.md` и `handoff.md`.

На текущем этапе закрыты discovery расположения/schema, создан каркас расширения и реализована чистая domain projection с первыми unit tests. SQLite adapter, UI, extension tests, ревью и VSIX ещё не завершены. Документированные решения и частичные unit tests не считаются доказательством прохождения полной приёмки.

Используемые статусы:

| Статус | Значение |
|---|---|
| `Не пройден` | Реализация и/или обязательная проверка отсутствует; положительного приёмочного доказательства нет. |
| `Не пройден (специфицировано)` | Требуемое поведение описано в нормативных документах, но ещё не реализовано и не проверено. |
| `Не пройден (блокировано discovery)` | Для реализации сначала требуется закрыть относящийся к ней discovery gate. |

## Acceptance scenarios

| Критерий | Реализация | Проверка | Доказательство текущего состояния | Статус |
|---|---|---|---|---|
| AC-1. Установка | Manifest и Activity Bar contributions созданы; offline runtime, production entrypoint и устанавливаемый VSIX ещё не проверены. | Требуется установка VSIX в чистый изолированный профиль и запуск без сети. Не выполнялась. | `package.json`; пункты I1, I4 и V4 ещё не завершены. | `Не пройден` |
| AC-2. Папка с Kilo-активностью | Расположение/schema подтверждены, domain projection реализована; adapter и дерево папок ещё не завершены. | Projection unit tests проходят; fixture/integration test и smoke test не выполнялись. | `docs/kilo-storage-discovery.md`, `src/projection.ts`, `tests/unit/projection.test.ts`. | `Не пройден` |
| AC-3. Папка без Kilo-активности | Projection не создаёт пустые groups; полная цепочка adapter/UI ещё не завершена. | Unit tests фильтрации проходят; integration test и smoke с контрольной папкой ещё не выполнены. | `src/projection.ts`, `tests/unit/projection.test.ts`; I2/I4/V4 не завершены. | `Не пройден` |
| AC-4. Названия диалогов | TreeDataProvider, раскрытые детали, три action nodes и строки title отсутствуют. Запрос metadata-only пока не подтверждён. | Требуется extension test порядка узлов и smoke test трёх title без чтения сообщений/файлов. Не выполнялись. | `req/step1/01-requirements.md`, разделы 5.3-5.4; `handoff.md`: UI и adapter не реализованы. | `Не пройден (блокировано discovery)` |
| AC-5. Группировка | Нормализация Windows paths, дедупликация и case-insensitive grouping реализованы в projection. | Соответствующие unit tests, включая 1 000 sessions, проходят; adapter/UI и smoke ещё не проверены. | `src/projection.ts`, `tests/unit/projection.test.ts`; последний локальный прогон 9/9. | `Не пройден` |
| AC-6. Обновление | Lazy-load, команда `Refresh`, атомарная замена in-memory model и удаление исчезнувших sessions не реализованы. | Требуется extension test и smoke test создания, переименования и удаления session без перезапуска VS Code. Не выполнялись. | `req/step1/03-technical-plan.md`, раздел 5 описывает алгоритм; `specs/step1-implementation-plan.md`, I4/V1/V4 не отмечены. | `Не пройден (специфицировано)` |
| AC-7. Открытие в текущем окне | Команда `kiloHub.openHere` отсутствует; предусмотрен вызов `vscode.openFolder` с `forceReuseWindow: true`. | Требуется тест аргументов команды и изолированный UI smoke test. Не выполнялись. | API-вызов описан в `req/step1/01-requirements.md`, FR-7; I4/V1/V4 в плане не отмечены. | `Не пройден (специфицировано)` |
| AC-8. Открытие в новом окне | Команда `kiloHub.openNewWindow` отсутствует; предусмотрен вызов `vscode.openFolder` с `forceNewWindow: true`. | Требуется тест аргументов и проверка отдельного окна с сохранением текущего. Не выполнялись. | API-вызов описан в `req/step1/01-requirements.md`, FR-8; I4/V1/V4 в плане не отмечены. | `Не пройден (специфицировано)` |
| AC-9. Недоступная папка | Состояние `missing`, сохранение titles и блокировка действий не реализованы. | Требуются unit/extension tests и smoke test удалённой папки с оставшейся историей. Не выполнялись. | Поведение задано в `req/step1/01-requirements.md`, FR-9; D4/I3/I4/V1/V4 в плане не отмечены. | `Не пройден (специфицировано)` |
| AC-10. Read-only | Неизменяемое read-only намерение является обязательным правилом; выбран `node:sqlite`, но adapter ещё не реализован и runtime внутри Extension Host не доказан. | Требуется сравнение fingerprints database/WAL/SHM до и после, включая конкурентную WAL-запись. Не выполнялось. | `agents.md` запрещает изменение `kilo.db`; `docs/sqlite-runtime-decision.md` фиксирует выбранный кандидат; D3 и V2 завершены только частично. | `Не пройден (блокировано discovery)` |
| AC-11. Нет ручного реестра | Архитектурное решение не создавать реестр зафиксировано; пользовательский интерфейс и package отсутствуют. | Требуется ревью manifest/UI/package и тест формирования списка только из Kilo data source. Не выполнялись. | Решение записано в `handoff.md`; запрет задан в FR-11; I1-I4 и V3/V4 не завершены. | `Не пройден (специфицировано)` |
| AC-12. Открытие в Проводнике | Команда `kiloHub.openInFileExplorer` отсутствует; предусмотрен стандартный VS Code API. | Требуется command test и smoke test в Проводнике Windows. Не выполнялись. | Поведение задано в `req/step1/01-requirements.md`, FR-10; I4/V1/V4 в плане не отмечены. | `Не пройден (специфицировано)` |
| AC-13. Фильтрация неподдерживаемых записей | SQL-фильтр root/non-archived и фильтры `.code-workspace`, remote URI, multi-root и UNC не реализованы. | Adapter/projection matrix специфицирована, но обезличенные fixtures и тесты отсутствуют; проверки не выполнялись. | `specs/step1-test-matrix.md`: U-001 и U-012-U-016 являются планом, а не результатом; D2/D4 и I2/I3 не отмечены. | `Не пройден (блокировано discovery)` |
| AC-14. Пустое название и сортировка | Fallback `Без названия`, Output warning и сортировка по timestamps не реализованы; семантика timestamps ещё не подтверждена. | Требуются unit tests fallback/warning и детерминированной сортировки с/без timestamps. Не выполнялись. | `req/step1/01-requirements.md`, FR-4/FR-5; D2/D4, I2/I3 и V1 в плане не отмечены. | `Не пройден (блокировано discovery)` |
| AC-15. Ошибка чтения | Состояние ошибки, user notification, сохранение последней корректной модели, Output Channel и повторный `Refresh` не реализованы. | Требуются tests отсутствующей/locked/busy/malformed database и повторного чтения. Не выполнялись. | Поведение задано в `req/step1/01-requirements.md`, NFR и `req/step1/03-technical-plan.md`; I2/I4 и V1/V2 не отмечены. | `Не пройден` |

## Definition of Done

| Пункт Definition of Done | Реализация | Проверка | Доказательство текущего состояния | Статус |
|---|---|---|---|---|
| DoD-1. Kilo data source и схема задокументированы | Фактические path, overrides, schema, timestamps, query и guard записаны. | D1-D2 подтверждены read-only discovery и CLI oracle. Финальное ревью документа ещё не выполнено. | `docs/kilo-storage-discovery.md`; D1-D2 отмечены в плане. | `Не пройден` |
| DoD-2. Kilo 7.7.5 поддерживается, несовместимая версия отклоняется | Минимальная версия задана, schema guard отсутствует. | Требуются тесты 7.7.5, совместимой новой и несовместимой schema с понятной ошибкой. | D2/I2/V1 в плане не отмечены. | `Не пройден (блокировано discovery)` |
| DoD-3. Read-only доступ подтверждён | Правило read-only зафиксировано, SQLite adapter отсутствует. | Требуются fingerprints database/WAL/SHM и тесты read-only connection. | D3/V2 в плане не отмечены. | `Не пройден` |
| DoD-4. SQLite runtime упакован и проверен при работающем Kilo | Выбран встроенный `node:sqlite`, но production adapter и пакет ещё не готовы. | Требуются WAL/concurrency test, production bundle test и проверка установленного VSIX. | `docs/sqlite-runtime-decision.md`; `handoff.md`: runtime выбран, но не доказан внутри Extension Host/VSIX. | `Не пройден (блокировано discovery)` |
| DoD-5. Metadata-запрос совпадает с official CLI oracle | Adapter и изолированная база для сверки отсутствуют. | Требуется сравнение ID/title/directory/root/archive на базе с менее чем 10 000 подходящих sessions. | `handoff.md`: отдельный `kilo` CLI отсутствует в `PATH`; V2 не отмечен. | `Не пройден` |
| DoD-6. CLI oracle использует фиксированный `--max-count 10000` | Команда нормативно зафиксирована, но запуск не выполнен. | Требуется протокол запуска точной команды без автоматического увеличения лимита. | `req/step1/02-discovery.md` задаёт лимит; проверочного отчёта нет. | `Не пройден (специфицировано)` |
| DoD-7. Все acceptance scenarios пройдены | Реализация сценариев отсутствует. | AC-1..AC-15 должны иметь положительные воспроизводимые доказательства. | В таблице выше все AC имеют непройденный статус. | `Не пройден` |
| DoD-8. Unit и integration tests проходят | Реализованы первые projection unit tests; adapter и extension integration tests ещё отсутствуют. | `npm run test:unit`: 9/9 projection tests passed; полный test run ещё невозможен. | `tests/unit/projection.test.ts`, локальный test report. | `Не пройден` |
| DoD-9. TypeScript compile и lint проходят | Конфигурации TypeScript, esbuild и ESLint созданы; projection компилируется. | `npm run check-types` и `npm run lint` проходят на текущем неполном коде; повтор обязателен после adapter/UI. | Локальные результаты команд; V1 пока не отмечен. | `Не пройден` |
| DoD-10. VSIX собирается воспроизводимо | Manifest и deterministic package/ZIP verification scripts созданы; production entrypoint и артефакт ещё отсутствуют. | Требуются два запуска `npm run package` и сравнение SHA-256. | `scripts/package.mjs`, `scripts/verify-vsix.ps1`; V4 не отмечен. | `Не пройден` |
| DoD-11. Пакет установлен и проверен на чистом profile | Устанавливаемого пакета нет. | Требуется установка в изолированный профиль и smoke test установленного Extension Host. | `handoff.md`: установка и smoke test не выполнены; V4 не отмечен. | `Не пройден` |
| DoD-12. Папки без Kilo-диалогов не отображаются | Фильтрация не реализована. | Требуются отрицательный automated test и контрольная папка в smoke test. | I3/V1/V4 в плане не отмечены. | `Не пройден` |
| DoD-13. Titles отображаются из Kilo data source | Adapter и UI отсутствуют. | Требуются adapter/extension tests и сверка с тестовой Kilo database. | I2/I4/V1/V4 в плане не отмечены. | `Не пройден` |
| DoD-14. Пустой title отображается как `Без названия` | Defensive fallback и warning отсутствуют. | Требуется malformed fixture и проверка UI/Output Channel. | D4/I2/V1 в плане не отмечены. | `Не пройден` |
| DoD-15. Три действия открытия проверены | Команды открытия отсутствуют. | Требуются command tests и изолированные smoke tests текущего окна, нового окна и Проводника. | I4/V1/V4 в плане не отмечены. | `Не пройден` |
| DoD-16. Расширение не изменяет Kilo storage | Запрет зафиксирован, но исполняемого расширения нет. | Требуются fingerprints и concurrent WAL test на упакованном расширении. | `agents.md` и план задают правило; V2/V4 не отмечены. | `Не пройден (специфицировано)` |
| DoD-17. Нет ручного реестра, add/remove folder и импорта `Open Recent` | Исключение зафиксировано архитектурно; UI/package отсутствуют. | Требуется ревью manifest, команд, storage use и содержимого package. | `handoff.md` фиксирует отсутствие реестра как решение; V3/V4 не завершены. | `Не пройден (специфицировано)` |
| DoD-18. Нет summary, LLM и поиска по текстам сообщений | Эти функции исключены нормативно; production bundle отсутствует. | Требуется code/package review, подтверждающее отсутствие функций и чтения message bodies. | Запреты есть в `agents.md` и требованиях; V3/V4 не завершены. | `Не пройден (специфицировано)` |
| DoD-19. Исключения путей описаны в release notes | Draft release notes описывает `.code-workspace`, multi-root, remote URI и UNC. | Требуется ревью и замена release candidate status после smoke. | `docs/release-notes.md`. | `Не пройден` |

## Исключённый scope

Наличие пункта в этой таблице означает запрет на его реализацию в Step 1, а не подтверждение того, что будущий код или пакет уже прошёл проверку на отсутствие функции.

| Исключено из Step 1 | Нормативный источник | Требуемый контроль границы | Текущее состояние |
|---|---|---|---|
| Ручное добавление папок | `req/step1/README.md`, раздел «Не входит в Step 1»; FR-11 | Не объявлять команду/UI; проверить manifest и package. | Исключение зафиксировано; реализация и package ещё не созданы. |
| Ручное удаление или скрытие папок | `req/step1/README.md`; FR-11 | Не объявлять команду/UI и не хранить пользовательское состояние. | Исключение зафиксировано; контроль кода не выполнялся. |
| Отдельный реестр папок Hub | `req/step1/01-requirements.md`, FR-11 | Источник истины только Kilo; проверить отсутствие durable registry. | Архитектурное решение записано в `handoff.md`; исполняемого доказательства нет. |
| Импорт или использование VS Code `Open Recent` | `req/step1/README.md`; `req/step1/02-discovery.md`, раздел 7 | Не читать `Open Recent`, не предоставлять Import Recent. | Исключение зафиксировано; контроль кода не выполнялся. |
| Summary, генерация title через LLM и любые LLM-вызовы | `req/step1/01-requirements.md`, FR-4 и NFR; `req/step1/README.md` | Title только из `session.title`; проверить зависимости, код и package. | Исключение зафиксировано; контроль кода/package не выполнялся. |
| Embeddings и semantic search | `req/step1/README.md` | Не добавлять индекс, модели и поисковый UI. | Исключение зафиксировано; контроль кода/package не выполнялся. |
| Поиск и чтение содержимого диалогов/message bodies | `agents.md`; `req/step1/01-requirements.md` | Metadata-only SQL; ревью точного запроса и adapter tests. | Запрет зафиксирован; запрос ещё не реализован и не проверен. |
| Чтение или индекс содержимого файлов проектов | `req/step1/01-requirements.md`, NFR; `req/step1/README.md` | Не запрашивать файлы проектов; code/package review. | Исключение зафиксировано; контроль кода не выполнялся. |
| Открытие конкретного Kilo-диалога | `req/step1/01-requirements.md`, раздел 5.4; `req/step1/README.md` | Conversation node не должен иметь navigation command. | Исключение зафиксировано; UI ещё не реализован. |
| Архивные и дочерние agent sessions | `req/step1/01-requirements.md`, FR-1 | SQL/filter должен принимать только `parent_id IS NULL AND time_archived IS NULL`. | Исключение задано; schema и фильтр не подтверждены. |
| `.code-workspace` и multi-root | `req/step1/README.md`; FR-2 | Projection filters и release notes; fixture tests. | Исключение задано; фильтры и тесты отсутствуют. |
| Remote SSH, WSL и Dev Container | `req/step1/README.md`; FR-2 | Принимать только локальные Windows path/file URI; fixture tests. | Исключение задано; фильтры и тесты отсутствуют. |
| UNC-пути | `req/step1/README.md`; FR-2 | Явный projection filter и fixture tests. | Исключение задано; фильтр и тесты отсутствуют. |
| Автоматический watcher изменений Kilo | `req/step1/README.md`; FR-6 | Только lazy-load и ручной `Refresh`; проверить contributions/runtime. | Исключение зафиксировано; runtime ещё не реализован. |
| Legacy history `globalStorage/kilocode.kilo-code/tasks/*.json` | `req/step1/01-requirements.md`, NFR; `req/step1/README.md` | Единственный runtime-источник — совместимая `kilo.db`; code review. | Исключение зафиксировано; adapter отсутствует. |
| Hub API, локальный HTTP API, MCP и Kilo tools | `req/step1/README.md`; `req/step1/02-discovery.md`, раздел 7 | Не добавлять серверы, порты и API contributions; проверить dependencies/package. | Исключение зафиксировано; контроль package не выполнялся. |
| Собственная индексирующая SQLite database Hub | `req/step1/03-technical-plan.md`, разделы 1 и 9; `req/step1/02-discovery.md`, раздел 7 | Не создавать БД Hub; допустима только in-memory model, пока не доказана необходимость технического кэша. | Решение in-memory зафиксировано; исполняемого доказательства нет. |
| Облачная синхронизация и telemetry | `req/step1/README.md`; `req/step1/01-requirements.md`, NFR | Не добавлять сетевые/telemetry зависимости и вызовы; offline/package review. | Исключение зафиксировано; AC-1 и package review не выполнены. |
| Платформы кроме Windows | `req/step1/01-requirements.md`, NFR; `req/step1/README.md` | Явная platform guard/package target и понятная ошибка вне Windows. | Ограничение зафиксировано; реализация и проверка отсутствуют. |
| Marketplace publication | `req/step1/04-preparation-and-acceptance.md`, раздел 1 | Не включать публикацию в критерии первого локального VSIX. | Исключение зафиксировано; локальный VSIX ещё не собран. |
