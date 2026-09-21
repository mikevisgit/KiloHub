# Повторное независимое security/read-only/CSP review Step 2

## Объект и границы проверки

- Проверен source commit `c5cd72b97a58ef991cf1abc73e7cb27c185d44fe` (`fix: resolve Step 2 production review findings`); `HEAD` указывал на `c5cd72b`.
- Исходные findings: `reviews/step2-production-security-review.md` на commit `b324982`.
- Заявленные исправления: `reviews/step2-production-remediation.md`.
- Прочитаны текущие production source, unit/component/integration tests, build/package/install/verifier scripts, `specs/step1-implementation-plan.md`, `specs/step2-implementation-plan.md` и `handoff.md`.
- Проверка охватывает source и сгенерированные browser/host bundles. VSIX `0.2.0` отсутствует, поэтому exact archive, negative VSIX verifier, reproducibility и installed-VSIX smoke в этом review не оцениваются.
- После чтения и автоматических прогонов target state в рабочем дереве появились параллельные изменения документов, scripts, production source и integration test. Они не относятся к commit `c5cd72b`, не использовались как evidence и не изменялись этим review.

## Итог по исходным findings

| Исходный finding | Статус | Evidence и disposition |
| --- | --- | --- |
| `MEDIUM-01` stale/current TOCTOU | **Исправлен** | `authorizeFolderAction()` проверяет active view generation, exact revision, folder в domain/state snapshot, availability и заново получает workspace descriptor (`src/kiloHubWebviewProvider.ts:337-407`). После `realpath/stat` executor вызывает final guard непосредственно перед VS Code API (`src/commands.ts:91-121`). Guard повторяет current/action matrix, revision, snapshot и generation; dispose/replacement также отклоняется. Deferred integration cases покрывают stale workspace, изменение revision и final guard (`tests/integration/index.ts:242-281`), а lifecycle case не принимает action старого view (`tests/integration/index.ts:294-335`). Production callback не передаёт третий аргумент явно, но guard сохранён как non-enumerable symbol на копии folder и извлекается `executeFolderAction()` (`src/commands.ts:64-75,100`; `src/extension.ts:77`). Обхода browser payload к path/URI/command не найдено. |
| `MEDIUM-02` resolved path/UNC/network | **Исправлен в части target; остаток принят в remediation как platform limitation** | Исходный path проходит lexical local-file guard, затем `realpath`, проверка resolved local drive path и `stat` canonical target (`src/windowsPathSafety.ts:4-48`). Команды используют именно `resolvedPath`, а не исходный alias (`src/commands.ts:91-121`); обычные и extended UNC отклоняются. Полные action paths удалены из toast и штатных Output сообщений. Остаётся документированное ограничение Windows: обращение к mapped/reparse path может вызвать network provider до получения resolved result; timeout не отменяет уже начатый `realpath/stat`; drive-letter database path открывается SQLite без drive-type/realpath guard; swap после последней проверки физически не исключён. `reviews/step2-production-remediation.md` принимает initial provider lookup, а `handoff.md` уже фиксирует эту границу. Реального mapped-drive/junction test нет; unit evidence ограничено строковыми UNC cases и локальным temp directory (`tests/unit/windowsPathSafety.test.ts:13-30`). Незавершённые probes дополнительно учтены в открытом `MEDIUM-04`. |
| `MEDIUM-03` adapter/DTO mismatch | **Исправлен** | Adapter принимает `id <= 512`, `title/directory <= 4096`, максимум `10000` строк и общий budget около `4 MiB` (`src/kiloDataSource.ts:13-18,236-315`). Protocol согласован: conversation ID `512`, folder ID/path/display text `4096`, `10000` folders/conversations и тот же global character budget (`src/webviewProtocol.ts:3-13,214-281`). Folder ID образуется из bounded directory, name является basename, а до browser передаются максимум три bounded conversations. Tests принимают точные границы и изолируют превышение отдельного поля (`tests/unit/kiloDataSource.test.ts:189-260`), protocol проверяет field/array/global limits (`tests/unit/webviewProtocol.test.ts:156-224,295-343`). Воспроизведённый ранее title `4097` теперь пропускается adapter с warning и не валит остальные строки. Риск одной экстремально большой SQLite value до JS validation относится не к несовместимости DTO, а к оставшемуся end-to-end resource finding ниже. |
| `MEDIUM-04` end-to-end resource bounds/chunked render | **Частично исправлен, остаётся открыт** | `.all()` заменён на `.iterate()`, введены row/character budgets, browser обрабатывает DTO порциями по 50 и отменяет старую generation (`src/kiloDataSource.ts:284-315`; `src/webview/main.ts:756-824`). Component tests подтверждают heartbeat и отмену stale render для 1000 folders (`tests/component/webviewMain.test.ts:523-583`). Однако SQL сохраняет `ORDER BY time_updated DESC` без `LIMIT` (`src/kiloDataSource.ts:20-31`). Targeted `EXPLAIN QUERY PLAN` на совместимой schema вернул `SCAN session` и `USE TEMP B-TREE FOR ORDER BY`: SQLite должен просканировать и отсортировать весь подходящий result set до первой строки iterator, поэтому JS row/character checks на строках `10001`/`4 MiB` не ограничивают предшествующую native memory/temp-I/O работу. Одна очень большая TEXT value также материализуется SQLite/Node до проверки длины. Worker limit `64 MB` относится только к V8 old generation, не к SQLite native/RSS/temp storage; timeout по-прежнему вызывает `void worker.terminate()` и отклоняет promise, не дожидаясь termination (`src/kiloDataSource.ts:329-391`). Кроме того, timeout `realpath/stat` не отменяет filesystem operation, а projection может последовательно запустить до `10000` таких probes при номинальной concurrency 16 (`src/windowsPathSafety.ts:23-48`; `src/projection.ts:300-336`). Следовательно, заявленный bound не замкнут до первой материализации и фактического завершения ресурсов. Нужны как минимум SQL-side bounded selection/plan evidence, disposition для oversized cell, ожидание worker termination и bounded/cancellable либо изолированная availability policy. |
| `LOW-01` dispose/revive generation | **Исправлен** | Provider хранит `viewGeneration`, проверяет конкретные view/generation до и после `postMessage`, сбрасывает `view/browserReady`, отклоняет ready waiters и запрещает action старого view (`src/kiloHubWebviewProvider.ts:66-89,96-128,171-219,409-425`). Deferred postMessage, dispose/revive, stale action, dispose-before-ready и ready timeout покрыты `tests/integration/index.ts:294-350`. Late publication не логируется как отказ нового Webview. |
| `LOW-02` раскрытие путей в Output/notifications | **Частично исправлен, остаётся открыт** | Action notifications стали generic; штатные action logs не содержат folder path, а exception detail заменяет исходный, URI и resolved path на `<local-path>` (`src/commands.ts:84-125`). Но остальные host surfaces продолжают писать `error.stack` без общей sanitization: refresh/workspace/action-wrapper/authorization/postMessage (`src/kiloHubWebviewProvider.ts:53-57,294,319,358,392,423`) и workspace listener (`src/extension.ts:89-92`). Worker передаёт полный stack host (`src/kiloDataWorker.ts:17-26`; `src/kiloDataSource.ts:358-363`). Targeted missing-DB error показал абсолютные строки `D:\VSCode\KiloHub\build-tests\src\kiloDataSource.js:...`; в установленном расширении аналогично раскрывается локальный install/profile prefix. Native/dependency error также может включить database/project path, не совпадающий с тремя строками command-redactor. Требование исходного finding о redacted home/project prefix либо stable diagnostic code выполнено только для command path. Нужна единая sanitization policy для всех Output exception paths; titles/message bodies логировать нельзя. |
| `LOW-03` CSP/local roots/package controls | **Исправлен на source/bundle уровне; package evidence ожидается** | HTML имеет exact `default-src 'none'`, nonce-only script, `style-src` только Webview source + nonce, `img-src 'none'`, `connect-src 'none'`; nonce создаётся `randomBytes(18)` и совпадает у script/dynamic style (`src/webviewHtml.ts:5-44`). Единственный `localResourceRoot` — `build/webview`, а не весь `build` (`src/kiloHubWebviewProvider.ts:106-113`). Integration test проверяет exact directives, запрет inline handlers/unsafe/data, nonce correspondence и root (`tests/integration/index.ts:200-220`). Browser собирается отдельно с `platform: browser`, без source maps (`scripts/build.mjs:20-40`); bundle scan прошёл и не нашёл Node require/import, fetch/XHR/WebSocket/EventSource/eval/source map (`scripts/verify-webview-bundle.mjs`). Расширенный независимый scan также не нашёл `sendBeacon`, storage/cache APIs, dynamic code, raw-HTML sinks или network URL в production browser source/bundle. Exact/negative VSIX scripts существуют, но не запускались без artifact `0.2.0`; nonce uniqueness не имеет отдельного regression test, хотя генерация каждым вызовом очевидна из source. Эти два пункта являются ограничениями evidence, не найденным CSP bypass. |

## Открытые findings

### MEDIUM-04 — SQLite и filesystem budgets остаются post-materialization/неотменяемыми

**Статус:** открыт, унаследован из первого review с новым доказательством query plan.

`.iterate()` устранил единый JS array, но не полную SQLite сортировку: production query не содержит SQL-side bound и при совместимой schema строит `TEMP B-TREE FOR ORDER BY` до первой итерации. Native SQLite memory/temp work и одна oversized cell не ограничены V8 `maxOldGenerationSizeMb`. После timeout завершение worker не ожидается. Отдельно filesystem timeout возвращает управление без отмены `realpath/stat`, поэтому номинальные 16 projection workers не являются строгим пределом реально выполняющихся OS I/O.

**Влияние:** schema-compatible локальная база большого размера или множество медленных mapped/reparse paths могут вызвать native memory/temp-I/O pressure и накопление незавершённых операций до срабатывания JS budgets. Это bounded по времени одного worker только best effort, но не доказанный end-to-end resource bound.

### LOW-02 — общая Output sanitization не реализована

**Статус:** открыт, унаследован из первого review.

Пользовательские action paths больше не показываются напрямую, но raw stacks из adapter/provider/workspace остаются. Они гарантированно содержат абсолютный путь установки и место вызова в bundle/test output и потенциально могут содержать database/project path из native error. Избирательный `replaceAll()` в `commands.ts` не применяется к этим каналам.

**Влияние:** локальные profile/install/project сведения могут попасть в diagnostic export или screen sharing, хотя в UI карточки они нужны только для отображения пользователю.

## Подтверждённые security/read-only свойства

- SQLite создаётся с `readOnly: true`, `allowExtension: false`, timeout `5000 ms`; `PRAGMA query_only = ON` задаётся connection-local, connection закрывается в `finally` (`src/kiloDataSource.ts:170-183`).
- Production SQL выбирает только семь metadata columns `session`, только root/non-archived rows. Запросов к message/content tables и чтения файлов проектов в production source/bundles не найдено.
- Production source не содержит filesystem write APIs, extension `globalState/workspaceState`, secrets, собственного cache/registry или runtime network client.
- Webview не содержит fetch/XHR/WebSocket/EventSource/beacon/storage/cache APIs, Node imports, raw-HTML sinks или dynamic-code execution. CSP дополнительно запрещает connect/images/default resources.
- Browser action содержит только version, revision, bounded folder ID и enum action. Path/URI/command ID не принимаются из Webview; external command contributions отклоняют непроверенный argument через `resolveFolderCommandReference() === undefined`.
- Runtime validators требуют exact plain objects/arrays, own enumerable data properties, bounded strings/counts/global characters и safe integer revision; accessor/prototype/symbol/sparse payload отклоняется.
- Пользовательские name/path/title попадают в DOM через `textContent`; hostile component test не создаёт script/img nodes.
- Domain snapshot остаётся в памяти host. `setState()` сохраняет только protocol version, `scrollTop` и 32-bit opaque hash раскрытой папки; raw ID/path/title/DTO не сохраняются (`src/webview/main.ts:25-29,163-191,497-503`). Hash является разрешённым техническим UI-state по плану/remediation, но остаётся производным идентификатором с возможными collisions, а не persistent metadata cache.
- `npm ls --omit=dev --all` вернул пустое runtime dependency tree. `vsce ls --tree` выбрал только manifest/license, host+worker, два browser assets, release notes и icon; fixtures, tests, requirements, reviews, DB/sidecars, source maps и `node_modules` не выбраны.

## Остаточные принятые ограничения

- Windows mapped drive/reparse resolution может обратиться к network provider до того, как `realpath` позволит отклонить resolved UNC; Node Promise timeout не отменяет kernel/provider operation. Это явно принято в remediation для initial lookup, но накопление operations остаётся частью открытого `MEDIUM-04`.
- Database resolver считает абсолютный drive-letter path локальным и не проверяет drive type. Доверенный `KILO_DB`/`XDG_DATA_HOME` может направить read-only reader на mapped drive; отдельной workspace-controlled границы нет.
- Между последней path/current проверкой и внешним VS Code API остаётся физически неустранимое без OS handle-based API окно reparse/delete swap. Исправление существенно сузило окно и использует canonical resolved target, но атомарность filesystem path не заявляется.
- Read-only WAL reader может менять технические read-marks существующего `kilo.db-shm`; DB/WAL/logical sessions не должны изменяться, побайтовая неизменность SHM не заявляется.
- Schema guard доказывает структуру семи columns, но не семантику будущей Kilo schema с теми же declarations.
- Persistent opaque expansion hash разрешён текущим UI-state contract; это не raw path/snapshot, но криптографической необратимости не имеет.
- Реальные mapped drives, junction swap, Chrome DevTools Network/CSP enforcement, GUI folder actions и installed VSIX этим source re-review не проверены.

## Выполненные проверки

Среда: Windows, Node `v24.13.0`, npm `11.6.2`; Extension Host tests: VS Code `1.105.1` и `1.138.0`.

- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` — `0 vulnerabilities`.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm test` — typecheck и ESLint прошли; unit `57/57`, component `29/29`, bundle scan pass, Extension Host VS Code `1.105.1` exit code `0`.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:integration:current` — bundle scan pass, Extension Host VS Code `1.138.0` exit code `0`.
- `npm ls --omit=dev --all` — production dependency tree пуст.
- `node node_modules/@vscode/vsce/vsce ls --tree` — source package selection ограничен восемью extension payload files.
- `git show --check --oneline c5cd72b` — прошёл.
- Static production/source/bundle scans — не найдены network clients, browser storage/cache APIs, raw-HTML/dynamic-code sinks, production filesystem writes, message/content queries или source maps.
- `npm run verify:webview-bundle` — прошёл дважды как часть minimum/current integration commands, bundle `32044` bytes.
- Targeted `EXPLAIN QUERY PLAN` production metadata query — `SCAN session`; `USE TEMP B-TREE FOR ORDER BY`.
- Targeted missing-database stack probe — подтвердил абсолютный локальный source/install prefix в stack.

Не запускались `npm run package`, `npm run package:repro`, `npm run verify:vsix`, `npm run test:verify-vsix-negative` и installed tests: `dist/kilo-hub-0.2.0-win32-x64.vsix` отсутствует, а задача запрещает создавать или изменять что-либо кроме этого review. Существующий VSIX `0.1.0` не относится к target commit.

## Счётчики и verdict

- Исходные findings: `7` (`Medium: 4`, `Low: 3`).
- Исправлены: `4` (`MEDIUM-01`, `MEDIUM-03`, `LOW-01`, source/bundle часть `LOW-03`).
- Закрыты принятым ограничением: `1` (`MEDIUM-02`, с перечисленными выше границами Windows path resolution).
- Остаются открыты: `2` (`Medium: 1` — `MEDIUM-04`; `Low: 1` — `LOW-02`).
- Новые самостоятельные findings: `0`. Query-plan evidence уточняет незакрытый `MEDIUM-04`, а не создаёт новый ID.
- Текущий severity summary: **Blocker: 0; High: 0; Medium: 1 открыт; Low: 1 открыт.**

Commit `c5cd72b` устраняет stale/current authorization race, открывает canonical resolved target, согласует adapter/protocol field limits, вводит generation/ready lifecycle, chunked browser render и существенно усиливает CSP/local-resource/package controls. Read-only/metadata-only/no-network/no-persistent-cache границы сохранены.

Security review exit Step 2 **не достигнут**: SQL/worker/filesystem resource lifecycle ещё не имеет доказанного end-to-end bound, а raw exception stacks не проходят общую privacy sanitization. После исправлений нужны targeted tests/re-review этих двух областей; затем отдельный package/installed review одного exact VSIX `0.2.0`.
