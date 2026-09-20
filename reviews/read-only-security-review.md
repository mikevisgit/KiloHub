# Независимое security/read-only ревью

## Findings

### HIGH-01: синхронный busy timeout блокирует весь Extension Host

**Файлы:** `src/extension.ts:51-65`, `src/kiloDataSource.ts:8`, `src/kiloDataSource.ts:143-154`, `src/kiloDataSource.ts:227-244`, `tests/unit/kiloDataSource.test.ts:257-269`.

`performRefresh()` вызывает синхронный `readKiloSessions()` до первой точки уступки event loop. Внутри используются синхронные `DatabaseSync`, `prepare().all()` и busy timeout `5 000 ms`. Тест с exclusive lock не только ограничивает ожидание, но и подтверждает непрерывную синхронную блокировку примерно на 4,5-7,5 секунды. На это время перестаёт обслуживаться весь локальный Extension Host, а не только view Kilo Hub; штатная блокировка со стороны Kilo или специально удерживаемый lock превращаются в локальный denial of service для других расширений. `docs/sqlite-runtime-decision.md:10` дополнительно расходится с реализацией и указывает `500 ms`, хотя код и тест используют `5 000 ms`.

Рекомендуется вынести SQLite-чтение из Extension Host event loop в worker/отдельный процесс либо выбрать асинхронный runtime. До этого как минимум следует существенно уменьшить timeout и фиксировать event-loop delay, а не только полное wall time операции.

### MEDIUM-01: проверка drive-letter path не гарантирует локальность и допускает сетевой I/O

**Файлы:** `src/kiloDataSource.ts:57-73`, `src/kiloDataSource.ts:102-108`, `src/projection.ts:78-91`, `src/projection.ts:271-279`, `src/extension.ts:36-40`, `src/commands.ts:27-44`, `src/commands.ts:70-90`, `tests/unit/projection.test.ts:44-65`.

Фильтры отклоняют только лексические UNC/remote значения и считают любой `X:\...` локальным. На Windows drive letter может быть mapped network drive, а путь на локальном диске может проходить через junction/symlink/reparse point к UNC target. При каждом refresh расширение автоматически вызывает `stat()` для всех таких путей. Это может инициировать SMB/network access и передачу Windows credentials, нарушает заявленную локальную/offline границу и способно зависнуть на системном network timeout. Таймаута или отмены для `stat()` нет; один зависший promise удерживает общий `Promise.all()` и `refreshInFlight`, после чего повторный Refresh не начинает новую попытку. Та же лексическая проверка позволяет открыть `kilo.db` на mapped drive через `KILO_DB`.

Тесты покрывают только явно записанные UNC и remote URI, но не mapped drives и reparse points. Нужна проверка фактического типа/target пути перед автоматическим доступом, ограничение времени availability check и отдельные Windows-тесты для mapped drive/reparse point. Если mapped drives сознательно считаются допустимыми, это должно быть явно согласовано как изменение требования «только локальные folders» и сетевой модели угроз.

### MEDIUM-02: источник не имеет ресурсных границ, а результат полностью материализуется

**Файлы:** `src/kiloDataSource.ts:10-21`, `src/kiloDataSource.ts:231-244`, `src/projection.ts:225-269`, `src/projection.ts:271-293`, `tests/unit/projection.test.ts:192-211`.

Production query не имеет лимита, `prepare().all()` синхронно материализует все подходящие строки, размеры `id`, `title` и `directory` не ограничены, а затем availability checks запускаются одновременно для всех уникальных папок через неограниченный `Promise.all()`. Большая, повреждённая или подменённая schema-compatible база может вызвать длительную блокировку, резкий расход памяти, массовый filesystem/network I/O и большое число строк Output для повреждений. Тест с 1 000 sessions проверяет только количество результата и вызовов; он не измеряет wall time, event-loop delay, память или concurrency, хотя план заявляет performance proof.

Нужно читать строки итеративно или порциями, ограничить параллелизм `stat`, установить защитные пределы на объём metadata и агрегировать повторяющиеся предупреждения. Performance gate должен измерять event-loop delay и поведение на заведомо избыточном входе.

### LOW-01: relative `KILO_DB` может выйти за каталог Kilo

**Файлы:** `src/kiloDataSource.ts:76-88`, `src/kiloDataSource.ts:106-117`, `tests/unit/kiloDataSource.test.ts:64-95`, `docs/kilo-storage-discovery.md:28-40`.

Проверка запрещает только значения, полностью равные `.` или `..`, но разрешает сегменты traversal внутри пути. `win32.resolve(kiloDataDirectory, '..\\shared.db')` выходит из каталога `kilo`; тест прямо закрепляет этот результат. Это расходится с документированным утверждением, что относительный override разрешается внутри каталога `kilo`, и повышает риск случайного чтения не той базы. Влияние ограничено тем, что абсолютный `KILO_DB` уже является поддерживаемым доверенным override, поэтому отдельного повышения привилегий здесь нет.

Для относительного override следует нормализовать итоговый путь и проверить, что он остаётся потомком `kiloDataDirectory`, либо явно исправить контракт и документацию, если traversal является намеренной совместимостью с Kilo.

### LOW-02: unsanitized session ID позволяет подделывать строки Output

**Файлы:** `src/kiloDataSource.ts:198-224`, `src/projection.ts:228-256`, `src/extension.ts:58-65`.

ID считается валидным, если это непустая строка; управляющие символы и переводы строк разрешены. При конфликтующем directory или пустом title этот ID без экранирования попадает в `OutputChannel.appendLine()`. Schema-compatible подменённая база может сформировать ложные префиксы и многострочные записи, визуально неотличимые от диагностики расширения. Title и тела сообщений в эти предупреждения не попадают.

Перед диагностическим выводом следует экранировать управляющие символы и ограничивать длину ID; повторяющиеся предупреждения следует агрегировать.

## Подтверждённые защитные свойства

- Production-код открывает SQLite через `DatabaseSync(..., { readOnly: true, allowExtension: false })`, дополнительно включает connection-local `PRAGMA query_only = ON` и закрывает connection в `finally`: `src/kiloDataSource.ts:143-155`.
- Production-код не выполняет migrations, checkpoint, изменение `journal_mode` или SQL-записи. Единственный data query является фиксированным `SELECT` семи metadata-полей из `session`: `src/kiloDataSource.ts:10-21`, `src/kiloDataSource.ts:226-244`.
- Таблицы `message`, `part`, transcript и содержимое файлов проектов production-кодом не читаются. `stat()` используется только для проверки самого пути каталога.
- Аргументы трёх open-команд нельзя подделать простым объектом: `KiloFolderTreeProvider` разрешает только объект той же identity, который присутствует в закрытом `WeakMap`, и пересоздаёт mapping при обновлении: `src/folderTreeProvider.ts:98-128`, `src/folderTreeProvider.ts:185-203`, `src/commands.ts:51-63`.
- Open-команды повторно проверяют `file` scheme, пустой authority, абсолютный drive path и наличие каталога; shell или ручная конкатенация команд не используются: `src/commands.ts:27-45`, `src/commands.ts:70-90`.
- Manifest ограничивает выполнение локальным UI Extension Host через `extensionKind: ["ui"]`, не объявляет telemetry/network capabilities и публикует только четыре команды Step 1: `package.json:15-22`, `package.json:47-88`.

## Остаточные риски

- Read-only SQLite connection в WAL-режиме может изменять технические read-marks существующего `kilo.db-shm`. Это не logical write, migration или checkpoint, но означает, что побайтовую неизменность всего storage заявлять нельзя. Тест `tests/unit/kiloDataSource.test.ts:235-255` сравнивает DB/WAL, но для SHM проверяет только длину, что соответствует принятому в документации допущению.
- Версия установленного расширения Kilo не атрибутирует происхождение выбранной базы. При отсутствии `kilocode.kilo-code` version gate пропускается, а для любой более новой версии проверяются только семь объявленных колонок и runtime-типы строк: `src/extension.ts:24-34`, `src/kiloDataSource.ts:120-141`, `src/kiloDataSource.ts:169-190`. Будущее семантическое изменение при неизменной форме schema этим guard не обнаруживается.
- Тесты доказывают видимость committed WAL и bounded busy error, но не покрывают production reader в каталоге без права записи, создание отсутствующего SHM, mapped drives/reparse points, concurrent commit во время длинного чтения и фактический event-loop delay. Эти сценарии перечислены в `specs/step1-test-matrix.md`, но в просмотренном automated suite отсутствуют.
- Технические ошибки и команды намеренно пишут полные локальные пути в Output и иногда показывают их в notification: `src/commands.ts:65-93`, `src/extension.ts:69-74`. Titles и message bodies туда не выводятся, однако пути остаются пользовательскими metadata и могут попасть в diagnostic export или screen sharing.
- `node:sqlite` остаётся external в production bundle и зависит от конкретного Extension Host. Manifest требует VS Code `^1.105.1`, но окончательная гарантия read-only/WAL поведения относится к установленному VSIX и целевым версиям хоста; исходные тесты сами по себе не закрывают этот packaging/runtime риск.

## Повторная проверка remediation 20.09.2026

Проверены текущие uncommitted изменения в `src/`, unit tests, build/manifest и runtime-документе. Исходные findings не удаляются: ниже записан их disposition относительно проверенного состояния.

| Finding | Disposition | Обоснование |
|---|---|---|
| `HIGH-01` | **Устранён в source и unit; Extension Host proof не завершён** | Синхронный `DatabaseSync` перенесён в отдельный worker, вызывающая сторона стала асинхронной, установлен общий timeout worker. Unit test подтвердил, что таймер основного event loop срабатывает во время примерно 7,2-секундного `SQLITE_BUSY`. |
| `MEDIUM-01` | **Частично устранён, остаётся Medium** | Добавлены `realpath`, проверка resolved path, таймаут availability check и повторная проверка перед командами открытия. Однако проверка сама сначала обращается к потенциально сетевому пути, timeout не отменяет незавершённые `stat/realpath`, mapped drive может сохраниться как drive-letter target, а путь `KILO_DB` resolved-local проверку не проходит. |
| `MEDIUM-02` | **Существенно смягчён, но не закрыт; остаётся Medium** | Добавлены timeout worker, `64 MB` old-generation limit, ограничения длины metadata, caps предупреждений и максимум 16 одновременных availability checks. При этом production query по-прежнему вызывает `.all()` без row limit до валидации длины полей; лимит old generation не ограничивает всю native/external память worker, полный массив клонируется обратно в Extension Host, а timeout отклоняет promise без ожидания завершения `worker.terminate()`. |
| `LOW-01` | **Не устранён, остаётся Low** | Логика relative `KILO_DB` не изменилась; `..\\shared.db` по-прежнему выходит из каталога `kilo`, и unit test продолжает закреплять это поведение. |
| `LOW-02` | **Устранён для исходного вектора** | Session ID в диагностике теперь ограничен 128 символами, C0/DEL заменяются, adapter и общий Output имеют caps. Unit test подтверждает отсутствие `\n` в warning для вредоносного ID. |

### HIGH-01

`readKiloSessions()` теперь создаёт короткоживущий `Worker` с отдельным entrypoint и возвращает `Promise`: `src/kiloDataSource.ts:274-335`, `src/kiloDataWorker.ts:1-27`. SQLite остаётся read-only/query-only внутри worker: `src/kiloDataSource.ts:159-171`, `src/kiloDataSource.ts:246-271`. `performRefresh()` ожидает worker асинхронно: `src/extension.ts:52-67`. Build создаёт и package allow-list включает `build/extension.js` и `build/kiloDataWorker.js`: `scripts/build.mjs:5-16`, `package.json:25-30`.

Тест `tests/unit/kiloDataSource.test.ts:279-301` запускает production-facing worker API под exclusive lock. В повторном прогоне timer `50 ms` сработал, пока worker завершил busy path примерно за `7 193 ms`; следовательно исходная блокировка event loop основного потока не воспроизводится. Worker имеет внешний предел `10 000 ms` и инициирует `terminate()` при превышении: `src/kiloDataSource.ts:9-10`, `src/kiloDataSource.ts:285-300`.

Остаток проверки: unit test запускает worker из `build-tests`, а успешный запуск отдельного worker bundle внутри VS Code Extension Host в этом прогоне не получен. `npm run test:integration` собрал оба production bundle, затем VS Code `1.105.1` отказался запускать extension tests, потому что уже работал другой экземпляр Code. До успешного host/installed-VSIX прогона packaging proof остаётся открытым, но исходный High по архитектуре event loop закрыт.

### MEDIUM-01

`isAvailableLocalDirectory()` параллельно вызывает `stat()` и `realpath()`, принимает только directory с resolved drive path и возвращает `false` через `500 ms` по умолчанию: `src/windowsPathSafety.ts:4-36`. Projection использует этот guard с максимум 16 параллельными checks, а команды повторяют его с пределом `2 000 ms`: `src/extension.ts:64-67`, `src/projection.ts:300-335`, `src/commands.ts:63-89`. Это закрывает бесконечное ожидание refresh на уровне UI и отбрасывает junction, если `realpath()` уже вернул UNC target.

Finding нельзя закрыть полностью по следующим причинам:

- `Promise.race()` не отменяет проигравшие `stat()` и `realpath()`; после возврата `false` операции продолжаются и при повторных refresh могут накапливаться: `src/windowsPathSafety.ts:20-35`.
- Чтобы определить UNC target reparse point, `realpath()` уже должен открыть/разрешить потенциально сетевой путь. Поэтому remediation ограничивает ожидание UI, но не предотвращает первоначальный SMB/network access или возможную credential negotiation.
- Mapped drive может разрешиться как `\\?\Z:\...` и принимается функцией как local drive-letter path; тесты проверяют строковые UNC/extended UNC, но не реальный mapped drive или reparse point: `src/windowsPathSafety.ts:4-14`, `tests/unit/windowsPathSafety.test.ts:12-27`.
- `resolveKiloDatabasePath()` и worker открывают `KILO_DB` без `realpath`/drive-type проверки, поэтому `KILO_DB=Z:\...` всё ещё может открыть SQLite по сетевому mapped drive: `src/kiloDataSource.ts:73-134`, `src/kiloDataSource.ts:246-255`.
- Между resolved-local проверкой команды и `openExternal`/`vscode.openFolder` остаётся TOCTOU: открывается исходный URI, а не зафиксированный resolved target: `src/commands.ts:70-89`.

Для закрытия Medium требуется pre-access проверка drive type/reparse policy, cancellable или изолированный filesystem probe, применение той же политики к database path и Windows integration tests с реальным mapped drive/reparse point. Если сама проверка target неизбежно допускает сетевое обращение, продукт должен явно выбрать и задокументировать допустимую модель риска вместо заявления о строго offline/local поведении.

### MEDIUM-02

Подтверждены следующие ограничения:

- worker timeout `10 000 ms` и `maxOldGenerationSizeMb: 64`: `src/kiloDataSource.ts:9-11`, `src/kiloDataSource.ts:285-300`;
- максимальная длина ID `512`, title/directory `32 768`: `src/kiloDataSource.ts:214-233`;
- не более 101 adapter-warning с итоговой строкой подавления и не более 101 строк warning на refresh в Output: `src/kiloDataSource.ts:257-269`, `src/extension.ts:41-50`;
- не более 16 одновременных availability checks: `src/projection.ts:300-335`.

Unit test подтвердил concurrency bound `<=16` на 1 000 sessions/100 folders: `tests/unit/projection.test.ts:214-240`. Однако нет targeted tests на превышение длины полей, 100/101 warnings, worker timeout и memory/resource termination. Главный источник неограниченной материализации остаётся: `.all()` извлекает все строки и значения до проверки длины и без ограничения количества: `src/kiloDataSource.ts:253-270`. Worker изолирует event loop, но разделяет процесс и его общий RSS с Extension Host; `resourceLimits.maxOldGenerationSizeMb` не является полным memory/RSS limit. После чтения весь результат одним `postMessage` клонируется в основной isolate: `src/kiloDataWorker.ts:14-26`, `src/kiloDataSource.ts:311-325`.

Для закрытия finding нужен явный maximum row/result budget до полной передачи, итеративное чтение вместо `.all()`, проверка oversize/budget error и тесты timeout/OOM-safe failure. Текущие меры заметно уменьшают вероятность и длительность отказа, но не дают строгой границы общей памяти процесса.

### LOW-01

`resolveRelativeDatabasePath()` всё ещё возвращает `win32.resolve(kiloDataDirectory, value)` без проверки принадлежности результата базовому каталогу: `src/kiloDataSource.ts:92-104`. Тест ожидает выход `..\\shared.db` в `D:\\Kilo Data\\shared.db`: `tests/unit/kiloDataSource.test.ts:83-89`. Disposition остаётся `не устранён`; влияние по-прежнему ограничено доверенным абсолютным override, поэтому severity не повышается.

### LOW-02

`diagnosticSessionId()` заменяет C0 и DEL, обрезает результат до 128 символов и применяется ко всем projection warnings с ID: `src/projection.ts:182-193`, `src/projection.ts:214-233`, `src/projection.ts:264-283`. Adapter warnings не включают ID/title, а оба уровня warning output ограничены: `src/kiloDataSource.ts:257-269`, `src/extension.ts:41-50`. Тест с ID `line\nbreak` подтверждает отсутствие перевода строки: `tests/unit/projection.test.ts:192-211`.

Исходный вектор многострочной подделки через CR/LF/ANSI control закрыт. Остаточный низкий риск Unicode format/bidi и line-separator characters (`U+2028`, `U+2029`) отдельно не тестируется и текущим фильтром не удаляется; он не меняет disposition исходного finding, но при усилении diagnostic hygiene следует перейти к allow-list printable characters или экранированию всех Unicode control/format/separator categories.

### Выполненные проверки

- `npm run check-types` — успешно.
- `npm run lint` — успешно.
- `npm run test:unit` — успешно, `26/26`; общий runtime около `14,9 s`.
- `npm run test:integration` — production bundles `build/extension.js` и `build/kiloDataWorker.js` успешно собраны; Extension Host tests не запущены, потому что VS Code `1.105.1` сообщил: `Running extension tests from the command line is currently only supported if no other instance of Code is running.`

Итог повторной проверки: открытых High findings в просмотренном source нет. Остаются два Medium (`MEDIUM-01`, `MEDIUM-02`) и один Low (`LOW-01`); `LOW-02` закрыт. Packaging/installed-host доказательство worker остаётся обязательным verification gate.

## Финальная проверка worker-enabled VSIX 20.09.2026

Проверен финальный commit `e77726559169687c66693c3865baaa95f936d7b3` и созданный из него worker-enabled пакет. Source tree перед проверкой не содержал tracked-изменений; единственным untracked-файлом был итоговый VSIX в `dist/`.

### Доказательства выпуска

| Проверка | Фактический результат |
|---|---|
| Clean dependency install | С `NODE_TLS_REJECT_UNAUTHORIZED=1` команда `npm ci` установила 239 packages и проверила 240 packages без TLS downgrade. |
| Dependency audit | `npm audit --audit-level=high` завершился успешно: `0 vulnerabilities`. |
| Полный automated suite | `npm test` прошёл: TypeScript, ESLint, `27/27` unit tests и Extension Host VS Code `1.105.1`; host завершился с code `0`. |
| Worker responsiveness | В финальном прогоне synchronous busy probe завершился примерно за `6 724 ms`, worker probe примерно за `6 836 ms`, а timer основного event loop сработал до ответа worker. |
| Live source | Обезличенный вызов production-facing `readKiloSessions()` через worker вернул `liveWorkerSessions=31` на рабочей Kilo DB. Titles и message bodies не выводились. |
| Exact package | `npm run verify:vsix` подтвердил ровно восемь разрешённых entries, включая `extension/build/extension.js` и `extension/build/kiloDataWorker.js`, корректные manifest/target и совпадение обоих packaged bundles со свежим build output. |
| Installed package | `npm run test:installed` повторно выполнил exact verification, установил VSIX в отдельные `--user-data-dir`/`--extensions-dir`, подтвердил `local.kilo-hub@0.1.0` и успешно завершил Extension Host refresh с code `0`. |

Идентичность проверенного артефакта:

- путь: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`;
- размер: `12 857` bytes;
- SHA-256: `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`;
- exact entries: `[Content_Types].xml`, `extension.vsixmanifest`, `extension/LICENSE.txt`, `extension/build/extension.js`, `extension/build/kiloDataWorker.js`, `extension/docs/release-notes.md`, `extension/package.json`, `extension/resources/hub.svg`.

### HIGH-01: закрыт

Disposition `HIGH-01` окончательно изменён на **закрыт с Extension Host и installed-VSIX proof**.

Финальная цепочка выполнения подтверждена на трёх уровнях:

- Unit runtime вызывает `readKiloSessions()` и сохраняет responsive main event loop при реальном `SQLITE_BUSY`: `tests/unit/kiloDataSource.test.ts:284-306`.
- Development Extension Host загружает свежие `build/extension.js` и `build/kiloDataWorker.js`, выполняет `kiloHub.refresh` и завершает тест с code `0`: `tests/integration/index.ts:146-224`.
- Installed harness сначала требует успешный exact verifier, затем устанавливает только проверенный VSIX, проверяет ID/version установленного продукта и запускает integration test с development path, указывающим только на отдельный harness extension: `scripts/run-installed-extension-tests.mjs:8-71`. Следовательно `local.kilo-hub` и его worker загружаются из изолированного installed extensions directory, а не из workspace extension build.

Прежний false positive installed test устранён error propagation: `performRefresh()` после user-facing диагностики повторно бросает исходную ошибку, а lazy visibility path отдельно поглощает её только для fire-and-forget вызова: `src/extension.ts:52-78`, `src/extension.ts:97-103`. Поэтому `await vscode.commands.executeCommand('kiloHub.refresh')` в `tests/integration/index.ts:198-215` не мог завершиться успешно при отсутствующем worker, schema failure или worker error. Успешный installed прогон является положительным доказательством packaged worker refresh, а не только регистрации команды.

### Schema guard и ошибки worker

Schema guard приведён к фактической семантике SQLite/Kilo 7.7.5. Для `id TEXT PRIMARY KEY` SQLite возвращает `notnull=0`, `pk=1`; production теперь проверяет primary-key flag для `id`, точный `NOT NULL` для обязательных metadata fields и nullable/non-PK состояние остальных: `src/kiloDataSource.ts:26-37`, `src/kiloDataSource.ts:178-220`. Негативный test без primary key добавлен в `tests/unit/kiloDataSource.test.ts:179-214`. Live worker успешно принял рабочую schema и вернул 31 session, поэтому прежний ложный schema reject устранён без ослабления проверки уникальной идентичности `session.id`.

Worker по-прежнему сериализует только message/stack ошибки, основной поток восстанавливает `KiloDataSourceError`, а refresh теперь пробрасывает failure вызывающей команде: `src/kiloDataWorker.ts:14-26`, `src/kiloDataSource.ts:326-349`, `src/extension.ts:71-78`. Это даёт installed harness наблюдаемый отрицательный результат для missing worker, несовместимой schema, timeout и SQLite error.

### Реальные остаточные риски

#### MEDIUM-01: первичная Windows path resolution может обратиться к network provider

Resolved-local guard, таймауты и concurrency bound защищают refresh от бесконечного ожидания и отклоняют UNC target после `realpath`, но не предотвращают само первоначальное разрешение потенциального mapped/reparse path. `Promise.race()` также не отменяет уже начатые `stat/realpath`, а trusted `KILO_DB` на mapped drive не проходит этот availability guard. Риск ограничен локальной Windows-конфигурацией и доверенными Kilo/environment paths, но возможность краткого SMB/network обращения остаётся. Финальный disposition: **Medium, принят как известное ограничение**.

#### MEDIUM-02: metadata query полностью материализуется внутри worker

Worker timeout `10 000 ms`, old-generation limit `64 MB`, ограничения длины fields/warnings и максимум 16 availability checks защищают основной event loop и ограничивают типовой ущерб. Однако `prepare(...).all()` всё ещё создаёт полный массив до row validation, а затем весь результат клонируется одним `postMessage`; V8 old-generation limit не является полным RSS/native-memory limit процесса. На подтверждённой рабочей базе с 31 session и тесте 1 000 sessions проблема не проявляется, но специально созданная schema-compatible база экстремального размера остаётся memory-pressure vector. Финальный disposition: **Medium, принят для Step 1 при доверенном локальном источнике**.

Открытых Low findings после финальной проверки нет. `LOW-02` закрыт sanitization/caps. Прежний `LOW-01` исключён из security residual: относительный `KILO_DB` намеренно повторяет официальный `path.resolve`, override документирован как доверенная пользовательская настройка и уже допускает абсолютный путь, поэтому `..` не пересекает отдельную security boundary: `docs/kilo-storage-discovery.md:28-40`.

Финальный security verdict: **High/Blocking findings отсутствуют; worker-enabled VSIX соответствует read-only границе и прошёл exact package плюс installed Extension Host verification. Остаются только два явно документированных Medium риска выше.**
