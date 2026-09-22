# Step 4: повторное исходниковое исследование по 0.3.2

## Статус и метод

Дата: 22 сентября 2026 года. Исследованы фактические исходники выпущенного Step 3, тестовая инфраструктура, release evidence и первичные внешние источники. Это новая исходниковая часть discovery, а не завершённый Gate 0. Среда исследования: Windows x64; реальные macOS, APFS, Finder, VoiceOver и Darwin Extension Host не проверялись.

Личная база Kilo, переписка и содержимое пользовательских проектов не читались. Production-код, установленные расширения и VSIX не изменялись. Прежнее [исследование 0.2.3](step4-preliminary-discovery.md) сохранено как история, его предположения о будущем Step 3 заменены ниже фактическими контрактами.

## Точный baseline

| Поле | Значение |
| --- | --- |
| Версия | `0.3.2` |
| Source выпуска | `ce9fba0906e49f756b17b53bf01b1f94273d0ff8` |
| HEAD исследования | `f7afdd5cb335fceb78c69b958b88379d0064a221` |
| Артефакт | `D:\VSCode\KiloHub\dist\kilo-hub-0.3.2-win32-x64.vsix` |
| Размер по release evidence | `55469` bytes |
| SHA-256, пересчитан при исследовании | `36227DB87DCC66B4E504E401E55852FF412883126CD2BA94B2CA546A08D29E67` |
| Windows runtime matrix выпуска | VS Code `1.105.1` / `1.138.0` |
| Manifest | VS Code `^1.105.1`, Node `>=22.19.0 <25`, `extensionKind: ["ui"]` |

`git diff ce9fba0906e49f756b17b53bf01b1f94273d0ff8 -- src scripts tests package.json package-lock.json` не показал изменений отслеживаемых файлов. Два уже существовавших неотслеживаемых `tests/discovery/step3-production-scale*` не входят в это сравнение и не используются как evidence выпуска.

[Отчёт выпуска](step3-verification.md) фиксирует два clean release цикла, 112 unit / 39 component в каждом, audit без уязвимостей, 7 negative cases, development/installed minimum/current и controlled PATH. В этом исследовании эти тесты не повторялись. Повторно проверен checksum артефакта, не выполнена повторная exact/package/install приёмка.

**Вход в реализацию пока заблокирован.** Выпуск 0.3.2 подтверждён, но ручная приёмка Details/picker/тем/zoom/NVDA не объявлена завершённой. План Step 3 сверху фиксирует выпуск, а ниже сохраняет старые открытые C/D пункты и статус кандидата 0.3.0; acceptance также содержит старый общий незавершённый статус. Перед production Step 4 следует согласовать итоговый статус по evidence, не закрывая ручные проверки автоматически. Настоящий Gate 0 дополнительно требует обеих нативных macOS-сред.

## Фактические контракты Step 3

### Runtime и поставка

`scripts/build.mjs:6–40` создаёт пять assets: `extension.js`, `kiloDataWorker.js`, `hubIndexWorker.js`, `webview/webview.js`, `webview/webview.css`. Node bundles используют CommonJS/node22; `vscode` и `node:sqlite` внешние. Webview target: chrome138. Runtime npm dependencies отсутствуют; поставляемого SQLite native addon нет. Это позволяет исследовать общий VSIX, но не доказывает совместимость Darwin runtime.

Exact verifier выпуска проверяет 13 entries, включая README для Details. Legacy `kiloDataWorker.js` остаётся в архиве и тоже должен учитываться при переносе. `package.json:18–25`, `src/extension.ts:54–94`: активация `onStartupFinished`, индекс стартует независимо от панели; storage берётся из `context.globalStorageUri.fsPath`. `src/hubIndexService.ts:133–144`: остановка worker с принудительным terminate через 10 секунд.

### Source, схема и восстановление

`src/hubSource.ts:39–83`: Kilo открывается `readOnly:true`, `allowExtension:false`, `query_only=ON`, snapshot через `BEGIN`; timeout 80 ms. Adapter проверяет `session/message/part`, принимает только root/non-archived sessions и user text без synthetic/ignored. Заполненный альтернативный формат `session_message/session_input` у допустимых sessions вызывает `source-ambiguous`. Это контракт adapter, не доказанная схема любой macOS-версии Kilo.

`src/hubIndexEngine.ts:72–97`: Hub `application_id=0x4b484233`, `user_version=3`, WAL, `synchronous=FULL`. Таблицы: `progress`, `sessions`, `texts`, `versions`, `work`, `sync_state`, `census`, `staged_texts`, `search_rows`, FTS5 trigram `search_fields`. Durable значения включают Windows `folder`, `directory`, `source_identity`: изменение identity нельзя считать косметической правкой UI.

`src/hubStorage.ts:51–70,106–147,196–255`: control file `hub-pointer.json`, format 1, поколения `hub-<UUID>.sqlite`, published/building/retired identities. Распознанные схемы 1/2 поддерживаются для предусмотренного чтения, актуальный writer строит новое поколение вместо in-place миграции в схему 3. Неизвестный control format остаётся fail-closed, не автоматически очищается.

`src/hubIndexEngine.ts:165–308`: metadata census порциями 100 строк / 256 KiB, durable FIFO заданий, сравнение metadata/content, staging и атомарная замена завершённого диалога. Удаления подтверждаются успешной сверкой. Полная сверка контента запускается примерно раз в 300 секунд. Готовая часть доступна поиску с `complete:false`; частичная запись диалога не публикуется.

`src/hubIndexWorker.ts:15–38`: pending work продолжается без паузы; обычная пауза после цикла 10 секунд, backoff до 300 секунд. Это не строгая гарантия свежести за 10 секунд. Ошибки сохраняют last-good. `quick_check` кэшируется по identity/schema и повторяется при соответствующей invalidation, не заменяя guards.

### Поиск и UI

`src/searchQuery.ts:1–18`, `src/hubIndexEngine.ts:365–424`: NFC/case/ё, минимум три Unicode code points во всём нормализованном запросе, короткие слова участвуют. AND по имени папки, названиям и допустимым текстам одной папки; полный путь не ищется. FTS5 trigram отбирает кандидатов, `instr` доказывает буквальное совпадение; короткие слова/NUL требуют literal fallback. Ранги: имя, затем title, затем user text; current первая только среди совпавших.

`src/webview/main.ts:544–575,828–920,972–1016`: debounce 300 ms, немедленный Enter/reset, IME, generation/revision и защита от старой chunk-отрисовки. Реплики остаются в worker; UI получает metadata и folder IDs/rank, без цитат и причины совпадения. Сохраняются обычные три последних названия диалогов, временная current-карточка без истории, плюсик и отсутствие ручного реестра. Поисковая NFC/case-нормализация не является допустимой заменой filesystem identity.

## Карта блокеров переноса

Ссылки на строки относятся к source baseline выше. Это подтверждённые зависимости кода, не результаты запуска на Mac.

| Область | Evidence | Последствие |
| --- | --- | --- |
| Запуск и Kilo discovery | `src/kiloDataSource.ts:86–146`, `src/hubIndexService.ts:28–66` | Resolver отвергает Darwin до создания worker; `USERPROFILE`, drive letters и `win32` задают Windows semantics overrides. |
| Folder identity | `src/projection.ts:26–132` | POSIX paths отвергаются, ключ всегда lowercase; case-sensitive APFS нельзя обслужить этим алгоритмом. |
| Импорт и поиск | `src/hubIndexEngine.ts:216–265,370` | Нормализация определяет импорт session/text; имя извлекается через `win32.basename`. Снятие раннего guard не добавит POSIX историю. |
| Физическая изоляция | `src/hubStorage.ts:13–48,73–81`, `src/hubSource.ts:42,87–92` | Windows canonical/lowercase и `dev:ino`; сравниваются source/target main и sidecars до записи. Нужна доказанная Darwin policy. |
| Missing/source replacement | `src/hubIndexEngine.ts:336–343` | Fallback identity использует `win32.normalize`; перенос должен сохранить различие исчезновения и другого источника. |
| Единственный writer | `src/hubStorage.ts:80–103`, `src/hubIndexEngine.ts:49–61,161–164` | Windows named pipe по identity storage плюс SQL owner fencing. Готового Darwin ownership нет. |
| Доступность и действия | `src/windowsPathSafety.ts:34–89`, `src/commands.ts:43–95` | Принимаются drive paths, нет macOS mount/locality contract; POSIX picker/current/open заблокированы. |
| Current и presentation | `src/currentFolder.ts:49–65`, `src/presentation.ts:238–247,383–399` | Grouping/current/цвета наследуют Windows identity. |
| Диагностика | `src/diagnostics.ts:1–18` | Redaction Windows/UNC не закрывает POSIX paths и `file:///Users/...`. |
| Finder | `src/commands.ts:144–157` | `openExternal(fileUri)` потенциально переносим, но фактическое открытие и тексты «Проводник» требуют адаптации/приёмки. |
| Legacy worker | `src/kiloDataSource.ts:332` | Путь packaged worker собирается через `win32.join`. |
| Release | `scripts/package.mjs:5,35–36`, `scripts/release.mjs:12`, `scripts/verify-reproducible-package.mjs:6` | Жёсткий target `win32-x64`. |
| Verification/installed | `scripts/verify-vsix.ps1:125–126`, `scripts/run-installed-extension-tests.mjs:19–64`, `tests/integration/index.ts:540–551` | PowerShell, Windows target, System32/where.exe/Path; отсутствие внешних tools на Mac этим не доказать. |
| Изоляция host | `scripts/isolated-test-host.mjs:7–37` | Windows layout product.json/mutex/AppUserModelId не доказывает изоляцию macOS `.app`. |

## Дополнительные риски хранения

1. **IPC lifetime.** Node.js 22.19 документирует Unix domain sockets вместо Windows named pipes. После crash socket может остаться в FS; типичный предел пути macOS 103 bytes. Windows pipe исчезает с последним handle. Поэтому нельзя просто заменить строку endpoint: нужны stale-owner, длинный storage path, permissions, гонка удаления endpoint и SQL fencing probes. Unix socket и file lock пока варианты, не принятое решение.
2. **Удаление открытого поколения.** `src/hubStorage.ts:149–165` повторяет cleanup после ошибки удаления; `tests/unit/hubSearch.test.ts:231` закрепляет Windows сценарий. POSIX unlink открытого файла может пройти успешно. Безопасность долгого reader, WAL/SHM и GC нужно доказать отдельно до переноса cleanup.
3. **Публикация и durability.** `src/hubStorage.ts:125–132` пишет unique temporary file с `wx`/`flush:true`, затем rename. Явного fsync родительского каталога нет; atomic visibility не доказывает сохранение pointer после потери питания на APFS. Нужен явно ограниченный и проверенный recovery contract, а не обещание power-loss safety.
4. **Permissions.** Создание storage/control files не задаёт отдельный POSIX mode (`src/hubStorage.ts:78,130,145`). Реальная защита зависит от parent/umask/ACL; нельзя обещать 0600/0700 без проверки DB, sidecars и временных файлов.
5. **Подмена файлов.** Последовательные realpath/stat/open проверки не являются доказательством защиты от любой конкурентной подмены. Для Darwin нужны symlink/hardlink, sidecar aliases, replacement каталога и негативные проверки до writable операций.
6. **Память.** Row-scaled admission в `src/hubSource.ts:14–19` не изолирует native SQLite allocations. Windows показатели не переносятся на arm64/x64; длинные поля и частые короткие токены должны измеряться заново без скрытого усечения истории.

Эти пункты являются рисками переносимости, а не объявлением воспроизведённых дефектов Windows выпуска.

## Повторно проверенные внешние источники

- [Kilo global.ts, фиксированный commit 01ef456](https://github.com/Kilo-Org/kilocode/blob/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb/packages/core/src/global.ts): data root строится из `xdgData` + `kilo`, XDG строки очищаются от CR/LF. Это не доказательство runtime path каждой версии/channel.
- [xdg-basedir 5.1.0](https://github.com/sindresorhus/xdg-basedir/blob/v5.1.0/index.js): fallback data root `os.homedir()/.local/share`; `XDG_DATA_HOME` имеет приоритет. Кандидат `~/.local/share/kilo/kilo.db` остаётся кандидатом, не окончательным macOS storage contract. DB filename/channel и `KILO_DB` необходимо проверить отдельно; попытка получить `packages/core/src/storage/db.ts` на указанном commit вернула 404 и доказательством не используется.
- [Node.js 22.19 IPC](https://nodejs.org/download/release/v22.19.0/docs/api/net.html#identifying-paths-for-ipc-connections): различия lifetime/длины Unix socket и Windows pipe подтверждены документацией, не macOS экспериментом.

Upstream `global.ts` также вызывает `markNoIndex` для данных Kilo. Это не доказывает защиту отдельного Hub storage от системного индексирования; при macOS privacy discovery следует выяснить фактическое поведение Spotlight, не добавляя автоматически новую продуктовую функцию или обещание защиты.

## Матрица завершения Gate 0

Все строки ниже **не выполнены на macOS**. Исследовательские probes допустимы вне production; проверка будущего реализованного Hub остаётся этапами A–E плана. Для каждого опыта записывать OS/архитектуру, VS Code/Node/Electron/SQLite, Kilo commit/channel, synthetic fixture, команду и обезличенный результат. Настоящий Intel Mac не заменяется Rosetta.

| ID | Исследование до выбора решения | Критерий и дальнейшая приёмка |
| --- | --- | --- |
| M01 | Native arm64/x64 × minimum/current VS Code | Worker, `node:sqlite`, JSON/BLOB/NUL, WAL, FTS5 trigram и точный `instr`; зафиксировать реальный runtime, не только manifest. |
| M02 | Kilo schema/discovery по поддерживаемым version/channel | Defaults, `KILO_DB`, `XDG_DATA_HOME`, relative overrides и WAL/SHM подтверждены исходниками/schema-only; неизвестные форматы fail-closed. |
| M03 | `globalStorageUri` default/named/temporary profiles, два окна, Stable/Insiders, отдельный user-data root | Известна область общего writer/storage; корпус не попадает в Settings Sync. |
| M04 | Case-sensitive/insensitive APFS, A/a, NFC/NFD, symlink/hardlink, rename/replacement/missing | Разные папки не сливаются, aliases не обходят изоляцию; политика учитывает durable keys схемы 3. |
| M05 | Locality: локальные/removable/network mounts и aliases под `/Volumes` | Проверяемый контракт без prefix-only эвристики; bounded availability без блокировки host. |
| M06 | Source/Hub/rebuild/main/sidecars/control files и permissions | Ни одна writable операция не достигает Kilo; подтверждены права новых и восстановленных файлов. |
| M07 | Кандидаты ownership: два процесса, crash, stale endpoint, длинные пути, simultaneous takeover | Ровно один writer, SQL fencing сохранён, чужой живой endpoint не удаляется. Выбор механизма только после опыта. |
| M08 | Publication/GC: долгий reader, WAL/SHM, unlink, busy/disk full, crash вокруг commit/rename | Last-good сохраняется; atomic switch/recovery и пределы durability сформулированы. Неизвестный pointer не очищается. |
| M09 | Startup без панели, sleep/wake, backlog, source replacement, shutdown | Прогресс не обнуляется, удаление только после полной сверки, нет оставшейся службы; затем повторить на production artifact. |
| M10 | Синтетический search oracle 0.3.2 и масштаб 1000 папок / 10000 диалогов / 100000 реплик | Короткие слова/NUL/Unicode/AND/rank/incomplete; cold import, search, update, reconciliation, heartbeat и RSS отдельно на двух архитектурах. Масштаб не предел истории. |
| M11 | Finder, picker, Return/Escape, IME, VoiceOver, focus, темы/reduced motion/200% | Выявить платформенные различия в прототипе; полная ручная приёмка после реализации. |
| M12 | Общий VSIX против двух target-пакетов; macOS harness без обязательного PowerShell | Утверждён способ exact/negative/reproducible/isolated installed проверки minimum/current без внешних Node/npm/SQLite/Kilo CLI. Полный Windows regression обязателен. |

Версии macOS, filesystem/storage/profile matrix, Rosetta policy и стратегия VSIX пока не утверждены. После новой версии Step 3 или изменения runtime/toolchain затронутые результаты должны быть повторены.

## Вывод и следующий этап

Главный объём переноса теперь конкретен: платформенная identity/locality, изоляция writable storage, ownership/recovery/GC и release harness. SQL sync/search, metadata-only transport, Webview protocol/CSP и UI state machine можно рассматривать как общий код, но переносимость подтверждается тестами, а не процентной оценкой.

Исходниковый baseline 0.3.2 зафиксирован. Следующее действие: подтвердить остаточную приёмку Step 3 и выполнить M01–M12 на доступных нативных macOS-стендах, после чего утвердить Gate 0 решения. Снятие Windows guards, production перенос и выпуск macOS данным исследованием не разрешены.
