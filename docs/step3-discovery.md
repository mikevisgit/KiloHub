# Step 3: предварительный discovery

## Статус

Исследование исходников выполнено 21 сентября 2026 года. Это source evidence, не завершённый runtime discovery и не утверждение стека. Личная `kilo.db` и реальные сообщения не читались, Kilo CLI не запускался, источник не изменялся.

Установленный Kilo Code сообщает `7.7.5`. Upstream-тег `v7.7.5` разрешён в commit `01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb`. Побайтовое соответствие встроенного executable этому commit не устанавливалось. Перед реализацией проверить фактически поддерживаемые версии.

## Первичные источники

Все пути относятся к [закреплённому commit](https://github.com/Kilo-Org/kilocode/tree/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb).

| Путь | Свидетельство |
| --- | --- |
| `packages/core/src/session/sql.ts` | Таблицы session/message/part, связи, timestamps и JSON data. |
| `packages/schema/src/v1/session.ts` | User/Assistant, TextPart, synthetic/ignored и события. |
| `packages/core/src/database/schema.sql.ts` | Timestamps и ORM `$onUpdate`. |
| `packages/core/src/session/projector.ts` | Upsert/delete message/part без обязательного изменения родительской session. |
| `packages/opencode/src/session/session.ts` | update/remove, setArchived и удаление журнала session. |
| `packages/opencode/src/session/compaction.ts` | Автоматические user messages и synthetic continue/replay. |
| `packages/opencode/src/session/revert.ts` | Удаления/изменения истории, источник не append-only. |
| `packages/core/src/event/sql.ts` | event/event_sequence, последовательность на aggregate. |
| `packages/core/src/event.ts` | Durable commit и удаление событий aggregate. |
| `packages/core/src/kilocode/session/recall-part-index.ts` | Поиск Kilo исключает synthetic/ignored text parts. |

## Подтверждено исходниками

- `message`: id PK, session_id FK с cascade, timestamps, JSON data с role. Текст хранится в parts, не в message.content.
- `part`: id PK, message_id FK с cascade, session_id, timestamps, JSON data. Продублированную part.session_id необходимо сверять со связями message/session.
- TextPart имеет text и необязательные synthetic/ignored. Role=user не доказывает человеческое авторство. Немаркированный смешанный текст нельзя надёжно разделить.
- `$onUpdate` — ORM-механизм строки, не SQL-trigger обновления родительской session.
- Изменение text-part и удаление message/part не обязаны менять session.time_updated. Архивирование также может сохранить updated. Watermark только по session неверен.
- `event_sequence`: aggregate_id/seq/owner_id. `event`: id/aggregate_id/seq/type/data; уникальность aggregate+seq. Это per-session cursor, не глобальный счётчик.
- Durable commit связывает projector, sequence и event одной транзакцией. Потоковые `message.part.delta` не durable.
- После удаления session Kilo удаляет её event/event_sequence. Постоянный tombstone удалённой session не гарантирован; нужна сверка ID.

## Инженерные выводы

Sequence можно рассматривать как оптимизацию, не единственную гарантию полноты. Читать актуальную целевую проекцию без копирования event payloads. Периодически сверять membership sessions/messages/parts после gap/reset/import/migration. Курсоры и проекцию фиксировать атомарно в Hub, источник читать согласованными короткими read-only snapshots. Ошибка/отмена не доказывает удаление. Эти решения ещё требуют runtime-доказательств.

## Незавершённый discovery

1. Schema guard, версии adapter и query plans bounded чтения без создания индексов в Kilo.
2. Initial snapshot/cursor при конкурентных изменениях, reconciliation и смена/замена исходной базы.
3. Отбор mixed/synthetic/ignored на синтетической истории.
4. SQLite/FTS5/tokenizers во встроенном runtime minimum/current VS Code, не только системном Node.
5. Буквальные подстроки, запросы 1–2 символа, Unicode и ё/е; FTS5 не подменяет семантику ТЗ.
6. Worker lifecycle, активация без панели, координация writer и реальная область storage профилей VS Code.
7. Защита от направления writable Hub connection в Kilo, включая идентичность файлов.
8. Бюджеты памяти/batch/диска, свежесть и интервал тяжёлой сверки на синтетическом корпусе.
9. Миграции только Hub, атомарная замена восстановленного индекса, disk full и crash recovery.
10. Установленный VSIX без Node/npm/SQLite/Kilo CLI в системе.

## Кандидат стека

SQLite, встроенный `node:sqlite`, Worker Thread, FTS5 только при доказательстве требуемой семантики. Предложение НЕ утверждено; результаты измерений и окончательный стек согласовать с пользователем до реализации собственной базы.

## Дополнительная проверка исходников 21 сентября

Повторно прочитан закреплённый `packages/core/src/session/sql.ts`. Для старой схемы доступны `message_session_time_created_id_idx(session_id,time_created,id)`, `part_message_id_id_idx(message_id,id)` и `part_session_idx(session_id)`. Это кандидаты для keyset/bounded чтения, но реальные query plans ещё необходимо проверить; индексы в источнике Hub создавать не будет.

В том же файле объявлены новые `session_message`, `session_input`, `session_context_epoch`. В `packages/schema/src/session-message.ts` новый `User` содержит `type=user`, `text`, `files`, `agents`, а `synthetic` является отдельным типом сообщения. Это не формат `message.role + part.type` из DB-06. Само наличие объявления не доказывает, что установленный runtime уже пишет этим путём или что legacy-проекция полна.

**Открытый вопрос Gate A:** выяснить маршрутизацию записи/чтения нового формата и наличие legacy-проекции. Не читать реальные сообщения и не объявлять совместимым источник только потому, что legacy-таблицы существуют. Если новый формат фактически используется без полной legacy-проекции, потребуется отдельный контракт adapter/уточнение DB-06 до реализации. Сейчас scope не расширен и такой adapter не реализован.

### Маршрутизация сообщений: последующее исследование

На том же pinned commit обычный VS Code чат действительно использует legacy-таблицы: `packages/kilo-vscode/src/KiloProvider.ts:4332–4368` → `client.session.promptAsync`, SDK `packages/sdk/js/src/v2/gen/sdk.gen.ts:5041` → `/session/{sessionID}/prompt_async`, handler `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:330–337` → `SessionPrompt`, `session/prompt.ts:1421–1461` → updateMessage/updatePart. Projector `packages/core/src/session/projector.ts:282–295,332–349` пишет message/part. Transcript reader `packages/kilo-vscode/src/kilo-provider/message-page.ts:19–38` использует session.messages, backend `message-v2.ts:561–578,223–235` читает те же legacy-таблицы. Название SDK/v2 само по себе не означает новый storage.

Отдельный `/api/session/:sessionID/prompt` (`packages/protocol/src/groups/session.ts:216–234`) вызывает SessionV2 → SessionInput.admit → session_input, затем Prompted → session_message. Reader `packages/core/src/session.ts:306–344` выбирает session_message с seq NOT NULL. Общего обратного зеркала в message/part не найдено. Новые routes зарегистрированы рядом со старыми, не только при experimentalEventSystem. Флаг KILO_EXPERIMENTAL_EVENT_SYSTEM включает отдельные dual-write события shell/compaction, но не является гарантией полной зеркальной истории.

Миграции `20260603040000_session_message_projection_order`, `20260622170816_reset_v2_session_state`, `20260714141136_session-message-legacy-writer-compat` подтверждают возможность reset журнала/новой проекции и coexistence seq NULL. Равные IDs/counts или seq NULL не доказывают полноту зеркала. Static inspection установленного extension.js подтверждает promptAsync/messages; бинарное присутствие кода не доказывает эффективные flags или историю всех писавших клиентов. Личная база и работающий сервер не опрашивались.

**Предлагаемая граница совместимости, ещё не production:** DB-06 остаётся legacy-only. Перед объявлением полного индекса выполнять bounded metadata-only EXISTS для session_message/session_input, связанных с допустимыми sessions, в том же snapshot. При таких строках считать источник неоднозначным, если их совместимость отдельно не доказана: сохранить last-good, не публиковать полноту и не удалять историю. Это консервативный отказ с возможными false positives (например, только shell-проекция), а не доказательство потери реплик. Пользовательский контракт «вся допустимая история» не ослабляется молча: ограничение смешанных источников должно быть включено в согласование adapter/стека. Импорт нового формата без отдельного контракта не добавляется.

Текущий production `src/kiloDataSource.ts`/`src/kiloDataWorker.ts` остаётся metadata-only: одноразовый worker с 10-секундным timeout и ограничением общего числа sessions. Этот механизм нельзя просто запустить каждые 10 секунд для всей истории: Step 3 требует порций, состояния прогресса и координации writer. Старые общие лимиты не должны молча стать пределами новой истории.

## Storage и активация VS Code: source evidence

Проверены pinned commits VS Code: `1.105.1` — `7d842fb85a0275a4a8e4d7e040d2625abbf7f084`, `1.138.0` — `7debcd0e2acdea1c52de81bf9ee1620444407dda`.

- `src/vs/workbench/services/extensions/electron-browser/localProcessExtensionHost.ts`, `_createExtHostInitData`: в обеих версиях `globalStorageHome` берётся у **defaultProfile**, не currentProfile.
- `src/vs/workbench/api/common/extHostStoragePaths.ts`, `globalValue`: к этому home добавляется lowercase extension ID. Разные профили одного user-data root могут иметь один физический каталог Hub. Свойства `globalState` этим исследованием не установлены.
- `src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts`: `extensionKind:["ui"]` выбирает LocalProcess на Desktop, не renderer и не отдельную службу.
- `src/vs/workbench/api/common/extHostExtensionService.ts`: `onStartupFinished` запускается после race eager activation/10s; это не гарантия готовности Kilo. На deactivation отведено максимум 5s.
- `src/vs/workbench/api/node/extensionHostProcess.ts`: закрытие renderer MessagePort инициирует завершение host.

Вывод: координация по физическому Hub store обязательна между окнами **и профилями**; profile name/workspace/PID не являются ключом изоляции. Source identity нужно отделить от storage identity, чтобы окна с разными источниками не перезаписывали чужие курсоры. Корректность записи не может зависеть от успешного `deactivate()`. Для lease необходимо fencing; один просроченный heartbeat не предотвращает запись старым worker.

Runtime-проверка ещё pending: изолированные Default/A/B профили одного user-data root, другой user-data root, одинаковый marker в probe storage, автоматическая активация без открытия панели и без явного `extension.activate()`, crash/takeover. Это уточняет DB-02, не обещая неподтверждённой изоляции профилей.

### Последующая runtime-проверка профилей

`tests/discovery/run-profile-probe.mjs` запускает отдельное тестовое расширение из `tests/discovery/profile-probe/` в настоящем Extension Host. Оно не импортирует Hub/Kilo и активируется только `onStartupFinished`; тест никогда не вызывает `extension.activate()`. Runner использует временные workspace/user-data/extensions каталоги и удаляет их после завершения; запись probe разрешена только внутри явно заданного synthetic root.

Команды: `node tests/discovery/run-profile-probe.mjs 1.105.1` и `node tests/discovery/run-profile-probe.mjs 1.138.0`. Launcher использует системный Node как тестовый инструмент, но probe исполняется на встроенном runtime VS Code. Это не финальная installed-VSIX проверка без Node в системе.

На обеих версиях четыре последовательных запуска прошли: Default, Discovery A, Discovery B в одном user-data root и Default в другом. В первых трёх `globalStorageUri` одинаков, marker первого запуска прочитан следующими профилями. В другом root каталог отличается и marker отсутствует. ExtensionKind = UI, runtime minimum Node 22.19.0/Electron 37.6.0, current Node 24.18.1/Electron 42.10.0. Current повторён с принудительным TLS verification, PASS; первым запуском обнаружено наследование небезопасной переменной среды, runner теперь принудительно задаёт `NODE_TLS_REJECT_UNAUTHORIZED=1`.

Закрыты вопросы startup activation без панели и фактического совместного storage профилей. **Не закрыты** одновременная работа нескольких hosts, writer takeover и shutdown/crash; последовательные окна этого не доказывают. Тестовая development extension не является установленным Step 3 artifact.

Последующее усиление runner: `--without-node` оставляет в PATH только Windows/System32, проверяет ENOENT при попытке запуска node/npm/sqlite3/kilo, затем выполняет FTS5-запрос в настоящем Extension Host. Minimum и current прошли все четыре profile/root запуска. Это доказательство независимости probe от внешних команд, не утверждение об удалении Node.js с машины и не замена installed Step 3 smoke.

`tests/discovery/step3-pipe-worker.cjs`: 4/4 на обоих bundled runtime; Worker Threads одного процесса не могут одновременно владеть pipe, await terminate владельца освобождает pipe для successor, следующий конкурент снова получает EADDRINUSE. Это дополняет process-death proof и не утверждает возможность немедленного прерывания активного SQLite вызова.

## Синтетический поиск: измерения

Последующее решение пользователя: в production искать только токены длиной от 3 Unicode code points; запрос с более коротким токеном отклоняется целиком до поиска. Приведённые ниже измерения коротких запросов и fallback сохраняются как историческое исследование, **не требование реализации**. Discovery-probe сравнивает низкоуровневые возможности, а не новый UI/host validation contract; fallback специально для 1–2 символов больше не нужен.

Воспроизводимый probe: `tests/discovery/step3-search.cjs`. Запускать bundled `Code.exe` с `ELECTRON_RUN_AS_NODE=1` и единственным аргументом пути probe; он не принимает пути к базам и использует только `:memory:`. Это встроенный Electron/Node, **не настоящий Extension Host и не установленный Step 3 VSIX**.

| Версия VS Code | Node / Electron / SQLite | Проверки | FTS build |
| --- | --- | --- | --- |
| 1.105.1 | 22.19.0 / 37.6.0 / 3.50.4 | 42 сценария, 345 assertions | 4.33 s |
| 1.138.0 | 24.18.1 / 42.10.0 / 3.53.1 | 42 сценария, 345 assertions | 4.97 s |

Корпус: 1000 папок, 10000 titles, 100000 user text полей, 21.52 MB нормализованного UTF-8; максимальное поле 18608 bytes. Один прогрев и три измеряемых прохода; обе стратегии сверяются с независимым JS-oracle. SQLite page size total до FTS 24.19 MB, после 72.41 MB. RSS 218–226 MiB включает JS-oracle и корпус, не является peak RAM будущего worker.

| Категория | 1.105.1 instr median/p95 ms | 1.105.1 hybrid | 1.138.0 instr | 1.138.0 hybrid |
| --- | --- | --- | --- | --- |
| 1–2 символа | 58.28 / 112.32 | 61.99 / 106.36 | 78.01 / 132.13 | 70.77 / 108.62 |
| Селективные | 71.11 / 155.43 | 0.62 / 52.87 | 75.92 / 184.46 | 0.57 / 40.50 |
| AND между полями | 117.30 / 177.84 | 0.65 / 57.47 | 141.84 / 246.57 | 0.66 / 64.04 |
| Частые подстроки | 86.24 / 352.74 | 184.82 / 488.41 | 96.35 / 276.70 | 181.98 / 522.65 |
| Длинные поля/запросы | 44.38 / 63.88 | 5.82 / 7.43 | 56.78 / 136.87 | 8.37 / 14.42 |

Измеренный hybrid = FTS5 `trigram case_sensitive 1` по предварительно нормализованным полям + обязательная точная проверка `instr`, для 1–2 Unicode code points полный `instr`. Проверены NFC/lowercase/ё, AND по полям одной папки, невозможность склейки разных папок/границ полей, буквальные кавычки/%/_/* и Unicode. MATCH короткого токена экспериментально не находит существующее совпадение; в текущем ТЗ такие токены запрещены вместо применения fallback.

FTS здесь ускоритель кандидатов, не определение семантики и не универсальный выигрыш. Частые подстроки примерно вдвое медленнее полного instr. Адаптивный выбор плана по селективности пока не доказан. Нельзя обещать SLA по тёплой in-memory выборке: disk/WAL, параллельная запись, отмена, NUL/некорректный Unicode и большие корпуса ещё pending. Тестовый объём не становится пределом пользовательской истории.

## Синтетическая синхронизация

Probe `tests/discovery/step3-sync.cjs` создаёт только временные synthetic source/Hub файлы и удаляет их в `finally`. На standalone Node 24.13.0 и bundled runtime обеих версий Code пройдены 9/9 проверок, 19 synthetic parts. Повторный запуск на minimum после добавления явных Node imports также PASS.

Проверены: запрет записи даже при снятом query_only у readOnly connection; неизменность main/WAL при чтении; joins и фильтры DB-06; согласованный snapshot текста/sequence при конкурентном commit; rollback частичной проекции вместе с курсорами; изменения/удаления/archive при неизменном session.time_updated; reset sequence и исчезновение session вместе с журналом; конкурирующие BEGIN IMMEDIATE; восстановление после выхода дочернего writer без close; отказ записи по совпадению realpath либо dev/ino hardlink. Hardlink не был пропущен.

Это прототип полной сверки маленькой legacy-проекции, **не production importer** и не доказательство совместимости session_message. SHM byte identity и устранение TOCTOU не утверждаются. Выход процесса с незакрытой транзакцией не равен сбою питания. Disk-full/corruption/реальные несколько Extension Hosts ещё не проверены. Busy timeout 80 ms фактически занимал около 145–158 ms: его нельзя использовать как строгий wall-clock budget.

Пример повторения в PowerShell из корня проекта:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& '.\.vscode-test\vscode-win32-x64-archive-1.105.1\Code.exe' '.\tests\discovery\step3-search.cjs'
& '.\.vscode-test\vscode-win32-x64-archive-1.105.1\Code.exe' '.\tests\discovery\step3-sync.cjs'
& '.\.vscode-test\vscode-win32-x64-archive-1.138.0\Code.exe' '.\tests\discovery\step3-search.cjs'
& '.\.vscode-test\vscode-win32-x64-archive-1.138.0\Code.exe' '.\tests\discovery\step3-sync.cjs'
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Скрипты запускаются отдельно; `npm test` их не выполняет, но lint охватывает. После добавления явных Node imports полный `npm test` прошёл: typecheck/lint, 62 unit, 29 component, bundle scan и minimum Extension Host. Этот Extension Host прогон проверяет **baseline Step 2**, не Step 3 probes.

## Решение после первого цикла

Кандидат: встроенный SQLite/Worker, таблица нормализованных полей и необязательный trigram-ускоритель с точным instr/fallback. Plain instr проще и выигрывает на частых токенах; FTS быстрее на селективных, но увеличивает объём. Окончательный выбор пока не предлагается к утверждению без проверки реального disk/worker поведения и источника нового формата.

Для следующего измерения предложены, но **не утверждены и не доказаны**: порция до 500 parts или 1 MiB с отдельной стратегией длинных parts без усечения, транзакции около 100 ms, reconciliation раз в 5 минут, обычная свежесть до 20 секунд при доступном источнике. Отсутствуют основание для жёсткого SLA и доказательство ограниченной peak RAM. Gate A остаётся открытым.

## Второй цикл: disk/WAL и минимум три символа

`tests/discovery/step3-disk-search.cjs` использует временную synthetic disk WAL DB и worker, не Kilo. Запуски через bundled Code 1.105.1/1.138.0 (`ELECTRON_RUN_AS_NODE=1`) прошли по 45 сценариев/450 сравнений с JS-oracle и 24 invalid/reset проверки без SQL. Корпус: 1000 папок/10000 titles/100000 реплик. Короткий токен отклоняет запрос целиком; пустой запрос сбрасывает фильтр.

| Категория | Minimum instr / FTS median ms | Current instr / FTS median ms |
| --- | --- | --- |
| Буквальные символы | 83.73 / 0.58 | 92.60 / 0.62 |
| Unicode | 77.19 / 0.53 | 100.48 / 0.60 |
| AND по полям | 207.43 / 1.44 | 191.23 / 1.56 |
| Частые подстроки | 115.74 / 246.30 | 140.56 / 343.54 |

Размер базы 24.22 MB без FTS, 72.44 MB с FTS. 40 конкурентных commit прошли без busy; принудительный конфликт writers дал SQLITE_BUSY за 156–169 ms при timeout 80 ms. Reader сохраняет snapshot и видит новую revision после транзакции. WAL вырос до 3.38 MB и освобождён после reader (checkpoint выполнялся только на **synthetic Hub**, не источнике Kilo).

Проверены отмена между порциями по 1000 строк и игнорирование устаревшего worker-ответа. NUL в MATCH вызывает SQL-ошибку на обоих runtime, literal instr сохраняет нужную семантику. Для такого редкого токена нужен fallback, даже после запрета 1–2 символов. Холодный cache, принудительное прерывание уже выполняющегося SQLite-вызова и byte-bounded обработка больших отдельных полей не доказаны. Эти измерения не SLA.

`tests/discovery/step3-source-guard.cjs`: 8/8 synthetic checks на обоих bundled runtime. Без чтения data/prompt обнаруживаются альтернативные записи, относящиеся к root/non-archived session, в том числе seq NULL; child/archive не вызывают отказ. Подтверждён только механизм консервативного обнаружения неоднозначности, не полнота старой/новой проекции и не production adapter.

## Текущее предложение и оставшийся gate

Техническая рекомендация по измерениям: SQLite через встроенный node:sqlite, операции вне основного потока в Worker, WAL только для Hub, нормализованные поля, FTS5 trigram как ускоритель плюс обязательный instr. Короткие токены запрещены; NUL направляется в literal-план. Частые токены и выбор scan/FTS требуют измеримого решения, а не обещания универсального ускорения. Нативные сторонние модули пока не нужны.

Последующее решение пользователя 21 сентября 2026 года: стек выше согласован. Первая версия adapter ограничена DB-06, неоднозначный источник получает безопасный отказ DB-09 с last-good, не молчаливое усечение. Остались схема fenced writer/длинных порций и бюджеты, проверка lifecycle при одновременных hosts. Реальный source не исследовался по строкам и не объявлен совместимым. Новый формат не добавляется молча; production не начат. **Gate A ещё не закрыт**, хотя отдельное согласование стека уже получено.

## Третий цикл: writer и исходный JSON

Evidence: `docs/step3-writer-design.md`, `tests/discovery/step3-writer-fence.cjs`, `tests/discovery/step3-json-extraction.cjs`. Bundled minimum/current подтвердили атомарное fencing внутри BEGIN IMMEDIATE, отказ stale owner, rollback при завершении владельца, ровно одного successor среди двух претендентов. Unicode/NUL scanner прошёл 63 oracle comparisons; исходный JSON probe обработал 100000 parts и отдельные поля до 12 MiB, включая 300000 combining marks.

Дополнительный `tests/discovery/step3-pipe-lock.cjs` прошёл 3 assertions на каждом bundled runtime: локальный Windows named pipe не допускает второго bind (`EADDRINUSE`), смерть владельца освобождает его, successor снова исключает конкурента. Это кандидат независимой от SQLite OS-координации восстановления повреждённого служебного store, не готовая реализация recovery. Не создаётся TCP-сервер или постоянная служба; ACL/защита от злонамеренного локального процесса не доказаны.

Важная поправка adapter: minimum runtime возвращает TEXT из json_extract только до первого NUL (39 bytes вместо 1048633). BLOB extraction с явным UTF-8 decoding сохраняет полный текст на обоих runtime. Новая реализация должна использовать этот путь, а не надеяться только на NUL fallback поиска.

**Блокер Gate A:** source JSON materializes в native SQLite независимо от размера результата substr. Для 12 MiB текста (20.85 MB JSON) первый chunk всего 32 KiB уже требует порядка 91–93 MiB process high-water; whole processing достигает 143.5/168.6 MiB и 383/393 ms. Worker.resourceLimits не ограничивает native SQLite; incremental BLOB API в node:sqlite отсутствует. Простое disk staging не исправляет это и замедляет extraction с ~0.13 s до 5–55 s.

Без изменения ресурсного контракта нельзя обосновать строгий малый memory/per-operation budget для произвольного допустимого поля. Это не доказательство невозможности всех реализаций Step 3: минимальный точный whole-field путь уже найден. Требуется явно выбрать row-scaled resource contract с безопасной изоляцией/отказом либо отдельно исследовать incremental-read API. Произвольный постоянный skip/лимит поля, изменение Unicode-семантики и global hard_heap_limit общего Extension Host не приняты и не внедрены. Согласование стека остаётся действительным; проблема не в повторном выборе SQLite, а в гарантиях ресурсов/полноты. Production не менялся.
