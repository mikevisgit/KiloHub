# Независимое ревью требований Step 1

Дата проверки: 20.09.2026.

Проверены `agents.md`, `handoff.md`, все документы `req/step1/`, `specs/`, production-код в `src/`, автоматические тесты, manifest, lockfile, scripts сборки и фактический состав существующего VSIX. Production-код, тесты и остальные документы не изменялись.

## Findings

### Critical/High

Не обнаружены.

### Medium

#### M-1. Отображаемый canonical path недетерминирован при равных timestamps

- Доказательства: `src/kiloDataSource.ts:10-21`, `src/projection.ts:225-269`, `specs/step1-test-matrix.md:68-69`, `specs/step1-test-matrix.md:81`.
- SQL сортирует строки только по `time_updated DESC`; порядок строк с одинаковым timestamp SQLite не определяет. При создании группы `directory`, а значит `name` и `uri`, берутся из первой встретившейся session. Case-insensitive `id` группы стабилен, но case-preserving представление зависит от входного порядка.
- Воспроизведение с двумя эквивалентными путями и одинаковым `timeUpdated` дало для одного `id = "c:\\repo"` сначала `file:///C:/Repo`, `name = "Repo"`, а после перестановки строк `file:///C:/repo`, `name = "repo"`.
- Влияние: label верхнего уровня, полный path и tie-break сортировки папок могут визуально меняться между `Refresh`, хотя набор sessions не менялся. Это не нарушает дедупликацию AC-5, но нарушает зафиксированное в U-008 правило детерминированного отображаемого canonical path и ослабляет детерминизм FR-5.

### Low

#### L-1. Некорректные и неоднозначные path records отбрасываются без требуемой диагностики

- Доказательства: `src/projection.ts:192-207`, `src/projection.ts:240-257`, `specs/step1-test-matrix.md:72-75`.
- `toCandidate` без предупреждения возвращает `undefined` для отсутствующего/некорректного `directory` и любого пути, который не прошёл normalization. В Output диагностируются только конфликтующий duplicate ID и пустой title.
- Фильтрация UNC, remote URI, `.code-workspace`, относительных и malformed paths работает, поэтому AC-13 не нарушен. Однако U-012/U-015 требуют диагностировать UNC и некорректную/неоднозначную связь без падения; такого доказательства и поведения сейчас нет.

#### L-2. Зафиксированный SQLite timeout противоречит фактическому runtime

- Доказательства: `docs/sqlite-runtime-decision.md:9-12`, `src/kiloDataSource.ts:7-8`, `tests/unit/kiloDataSource.test.ts:257-270`, `handoff.md:46`.
- Документ решения указывает `timeout: 500`, production-код и тест используют `5000 ms`; фактический тест `SQLITE_BUSY` занял около `6.8 s`.
- Фиксированного порога FR/AC не задают, и ожидание ограничено, поэтому это не функциональный отказ. Но release/runtime contract неоднозначен, а блокировка синхронного Extension Host в десять раз длиннее документированной.

## Трассировка FR

| Требование | Результат | Доказательства и ограничения |
|---|---|---|
| FR-1 | Соответствует по коду; package smoke не завершён | Read-only `DatabaseSync`, `query_only`, metadata-only SQL, root/non-archived WHERE и отсутствие CLI runtime: `src/kiloDataSource.ts:10-31`, `src/kiloDataSource.ts:143-155`, `src/kiloDataSource.ts:226-244`. Таблицы сообщений не запрашиваются. |
| FR-2 | Частично соответствует | Drive paths и local file URI нормализуются; UNC, remote и `.code-workspace` исключаются: `src/projection.ts:26-133`. Группировка case-insensitive работает, но отображаемый canonical path имеет M-1. |
| FR-3 | Соответствует | Папки создаются только из валидных candidates и непустых групп: `src/projection.ts:225-293`; `Open Recent` и текущий workspace не читаются. |
| FR-4 | Соответствует | `session.title` сохраняется, пустой title получает `Без названия`, warning направлен в Output: `src/projection.ts:209-217`, `src/projection.ts:251-257`, `src/extension.ts:58-65`. |
| FR-5 | Частично соответствует | Conversations и folders сортируются по timestamp с name/ID tie-break: `src/projection.ts:162-189`, `src/projection.ts:271-300`. M-1 делает folder name/path нестабильным для эквивалентных case variants. |
| FR-6 | Реализовано, но end-to-end не доказано | Lazy visibility и объединение параллельных refresh: `src/extension.ts:48-50`, `src/extension.ts:78-118`. Модель заменяется только после полного успешного чтения: `src/extension.ts:51-75`. Нет теста create/rename/delete/error/recovery через фактический view. |
| FR-7 | Реализовано, не принято | `vscode.openFolder` с `{ forceReuseWindow: true }`: `src/commands.ts:87-90`. Нет command test и установленного smoke. |
| FR-8 | Реализовано, не принято | `vscode.openFolder` с `{ forceNewWindow: true }`: `src/commands.ts:87-90`. Нет command test и установленного smoke. |
| FR-9 | Реализовано, частично проверено | Missing folder остаётся с conversations; folder имеет warning icon, actions не получают command и имеют tooltip: `src/projection.ts:271-292`, `src/folderTreeProvider.ts:164-172`, `src/folderTreeProvider.ts:191-207`. Нет проверки полной цепочки refresh и пользовательского поведения. |
| FR-10 | Реализовано, не принято | Перед открытием повторно выполняется `stat`, затем `vscode.env.openExternal(uri)`: `src/commands.ts:63-84`. Нет command test и ручного Explorer smoke. |
| FR-11 | Соответствует по статическому аудиту | Модель только in-memory; `globalState`, `workspaceState`, Hub DB и registry writes отсутствуют. |

## Трассировка AC

Ниже `частично` означает, что требуемое поведение видно в коде и/или узком automated test, но полного acceptance-доказательства из установленного VSIX нет.

| AC | Статус | Основание |
|---|---|---|
| AC-1 Установка | Не пройден | VSIX существует и архив проверен, но установка/activation в чистом profile из установленного пакета не зафиксированы. Extension Host test загружает workspace через `extensionDevelopmentPath`, а не установленный VSIX: `scripts/run-extension-tests.mjs:10-18`. |
| AC-2 Папка с активностью | Частично | Fixture читается при `kiloHub.refresh`, но integration test не проверяет фактически построенный root item: `tests/integration/index.ts:160-212`. |
| AC-3 Папка без активности | Частично | Projection не создаёт пустые folders; отрицательный end-to-end сценарий с существующей контрольной папкой отсутствует. |
| AC-4 Titles и детали | Частично | Отдельный provider test подтверждает порядок path/actions/conversation для одной строки: `tests/integration/index.ts:99-143`; три реальные sessions через adapter/view не проверены. |
| AC-5 Группировка | Частично | Case-insensitive grouping покрыта unit test; M-1 нарушает детерминированность display path. |
| AC-6 Refresh | Не пройден | Реализация атомарной замены есть, но отсутствует create → rename → delete → delete-last и error/recovery test. |
| AC-7 Open Here | Не пройден | Вызов реализован, но аргументы команды и фактическая смена workspace не проверены. |
| AC-8 Open in New Window | Не пройден | Вызов реализован, но аргументы команды и отдельное окно не проверены. |
| AC-9 Missing folder | Частично | Tree provider проверяет отсутствие command у трёх missing actions, но нет refresh с удалённой folder и проверки сохранённых titles через view. |
| AC-10 Read-only | Частично | Unit tests подтверждают read-only/query-only, неизменность DB/WAL и чтение committed WAL; установленный production package и полный concurrency/manual fingerprint gate не пройдены. |
| AC-11 Нет registry | Соответствует по статическому аудиту | Manifest содержит только четыре нормативные команды; storage writes и add/remove/hide/import отсутствуют. Ручной осмотр UI/Command Palette не выполнен. |
| AC-12 Explorer | Не пройден | Стандартный API используется, но ни подмена API, ни фактический Windows Explorer не проверены. |
| AC-13 Фильтрация | Соответствует по automated coverage | SQL исключает child/archive; unit tests исключают UNC, remote URI, `.code-workspace`, invalid и missing directory. Осталась L-1 по диагностике. |
| AC-14 Fallback и sorting | Частично | Unit tests подтверждают fallback, warning callback и сортировку; реальный Output/view и M-1 остаются непроверенными. |
| AC-15 Ошибка чтения | Не пройден | Код сохраняет folders, потому что `provider.setFolders` вызывается только после успеха, и оставляет `Refresh`; нет Extension Host test первого failure, failure-after-success, recovery, view message и Output details. |

## UI Contract

- Container `Kilo Hub`, view `Kilo Folders`, Activity Bar icon и toolbar `Refresh` объявлены в `package.json:29-73`.
- Верхний уровень плоский; folder item имеет только label, без description/command, и раскрывается нативно: `src/folderTreeProvider.ts:144-172`.
- Порядок детей точный: path, `Open Here`, `Open in New Window`, `Open in File Explorer`, conversations: `src/folderTreeProvider.ts:152-161`.
- Tooltip folder содержит path, count, timestamp и missing state: `src/folderTreeProvider.ts:79-92`.
- Conversation показывает title, optional date и не имеет command: `src/folderTreeProvider.ts:210-223`.
- Inline/context menu contributions отсутствуют; open actions скрыты из Command Palette и существуют только как nodes дерева: `package.json:67-88`.
- Webview отсутствует. UI contract по статическому коду выполнен, кроме влияния M-1 и отсутствующих end-to-end проверок.

## Path, Refresh, Error и Missing

- Поддерживаются абсолютные drive paths и local `file` URI; separator, trailing separator, `.`/`..`, percent-encoding, пробелы и Unicode обрабатываются.
- UNC, authority кроме `localhost`, remote schemes, relative/drive-relative paths, invalid Windows segments, NUL/control chars, reserved device names и `.code-workspace` исключаются.
- `KILO_DB` имеет приоритет над `XDG_DATA_HOME`; абсолютный override используется прямо, относительный разрешается относительно Kilo data directory, default равен `%USERPROFILE%\.local\share\kilo\kilo.db`: `src/kiloDataSource.ts:57-118`.
- Refresh повторно разрешает путь и каждый раз открывает короткоживущую connection; постоянной SQLite connection нет.
- При ошибке предыдущая модель не очищается, view получает понятный error message, детали записываются в Output, повторный `Refresh` остаётся доступен: `src/extension.ts:51-92`.
- Missing определяется отдельно для каждой folder; ошибка одного `stat` не ломает остальные folders: `src/projection.ts:271-292`.
- Поведение соответствует требованиям по коду, но refresh/error/missing transitions не покрыты Extension Host test.

## Excluded Scope

Запрещённые функции в production-коде, manifest и VSIX не обнаружены:

- нет add/remove/hide/import/copy-path команд и ручного registry;
- нет `Open Recent`, watcher/timer, legacy task JSON или durable cache;
- нет message/part/transcript query, summary, LLM, embeddings или search;
- нет чтения/индекса project files, кроме точечного `stat` самой folder;
- нет открытия конкретной conversation;
- нет telemetry, network/backend/API/MCP/cloud sync;
- нет runtime npm dependencies; `npm ls --omit=dev --all` вернул пустое production tree;
- package содержит только manifest metadata, bundle, release notes, license и icon; tests/fixtures/sources/DB отсутствуют.

## Testing Gaps

1. Нет автоматической проверки lazy first visibility (`I-021`): текущий host test активирует extension прямой командой `Refresh`.
2. Нет `I-025`–`I-027`: create/rename/delete/delete-last, сохранение последней корректной модели, first-load error и recovery.
3. Нет автоматических `I-030`–`I-032`: точные аргументы `vscode.openFolder`, вызов `openExternal`, повторный `stat` и ошибки доступности.
4. Missing покрыт только прямым вызовом provider с готовой моделью; нет adapter → projection → view refresh сценария и проверки notifications.
5. Нет instrumented metadata-only authorizer test `I-008`; безопасность сейчас доказывается статическим SQL и отсутствием message fields в bundle.
6. Не закрыты полностью `I-007`, `I-011`, `I-013`, `I-014`, `I-016`: malformed DB, read-only directory, атрибуция SHM/WAL, concurrent commit во время чтения и освобождение ресурсов для всех error paths/deactivate.
7. Performance test измеряет только projection 1 000 sessions и не фиксирует заранее budget/event-loop delay всей цепочки adapter + projection (`I-019`). Синхронный busy path фактически блокировал примерно на `6.8 s`.
8. Нет автоматической проверки Output Channel для schema/read errors, пустого title и privacy-состава сообщений (`I-033`).
9. Не выполнены два чистых запуска package с сравнением артефактов (`P-002`); один существующий VSIX не доказывает воспроизводимость.
10. Не запущены SQLite/read-only/WAL tests через entrypoint распакованного или установленного VSIX (`P-005`, `P-006`). Совпадение SHA-256 workspace bundle и bundle внутри текущего VSIX подтверждено, но не заменяет installed-host test.
11. Нет сохранённого offline/network instrumentation и installed-package proof отсутствия CLI/network/runtime data dependencies (`P-007`, `P-008`, `P-010`). Статический аудит нарушений не выявил.
12. `tests/integration/index.ts` подтверждает manifest/runtime registration, отдельный tree contract и fingerprint fixture, но не инспектирует model/view после реального refresh.

## Manual Gates

До приёмки остаются все обязательные сценарии установленного пакета `M-001`–`M-021`, в частности:

1. Установить именно итоговый VSIX в отдельные `--user-data-dir` и `--extensions-dir`; проверить offline activation без Kilo CLI.
2. Проверить фактический Activity Bar, плоский collapsed UI, длинные/non-ASCII titles, tooltips и точный порядок expanded nodes.
3. Выполнить create, rename, delete, delete-last и ручной `Refresh` без restart.
4. Временно сделать source недоступным, убедиться в сохранении предыдущей модели, понятной ошибке, Output details и успешном retry.
5. Удалить folder при сохранённой session; проверить missing visual state, titles и блокировку всех трёх действий.
6. Фактически проверить `Open Here`, `Open in New Window` и Windows Explorer.
7. Проверить одновременно работающий Kilo, committed WAL changes и fingerprints DB/WAL/logical rows до/после; SHM оценить по оговорённым read-marks.
8. Проверить 100 folders/1 000 sessions по заранее заданному численному UI/event-loop budget.
9. Осмотреть toolbar, folder rows, context menus и Command Palette на отсутствие excluded commands; убедиться, что conversation click пассивен.
10. Повторно собрать из чистого состояния, проверить воспроизводимость, установить полученный файл и записать итоговые path/version/size/SHA-256 и версии среды.

`handoff.md:29-34` и `handoff.md:73-75` пока не отражают существующий артефакт и выполненные автоматические проверки полностью. До закрытия manual/package gates Step 1 по правилу `specs/step1-implementation-plan.md:146-148` не завершён.

## Выполненные проверки

- `npm test` — успешно: typecheck, ESLint, 22 unit tests и Extension Host VS Code `1.105.1`, exit code `0`.
- `npm run verify:vsix` — успешно; состав: семь entries без source/tests/fixtures/DB/node_modules.
- Проверенный файл: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`.
- Размер на момент ревью: `10843` bytes.
- SHA-256 на момент ревью: `C4EDE6153929FE883318DC8285F2B2F87374449FBF97199D7033F6CC7FFE7143`.
- SHA-256 `build/extension.js` совпал с `extension/build/extension.js` внутри VSIX.
- `npm ls --omit=dev --all` — production dependency tree пуст.
- `git diff --check` — exit code `0`; выданы только предупреждения Git о будущей конвертации LF/CRLF в параллельно изменённых файлах.
- `npm run package` повторно не запускался, чтобы не перезаписывать существующий артефакт; воспроизводимость не заявляется.

## Итог

Статический аудит не выявил Critical/High дефектов, чтения тел сообщений, записи в Kilo storage или функций вне Step 1. Основная реализация FR присутствует, но M-1 требует исправления либо явного пересмотра детерминированного path contract. Полная приёмка AC-1–AC-15 заблокирована отсутствующими end-to-end tests и manual smoke установленного VSIX.

## Повторная проверка исправлений

Проверка выполнена 20.09.2026 по текущим uncommitted remediation changes. Этот раздел обновляет статусы M-1, L-1 и L-2 выше, но сохраняет первоначальные формулировки как историю ревью.

### Статусы findings

| Finding | Статус | Новые доказательства |
|---|---|---|
| M-1. Недетерминированный display path | **Исправлено и проверено** | `src/projection.ts:205-212` задаёт полный comparator display candidate: timestamp, session ID, path. `src/projection.ts:278-292` выбирает кандидата сравнением, а не порядком входа. Тест `tests/unit/projection.test.ts:90-103` переставляет равные case variants и подтверждает одинаковые `uri` и `name`. Оба запуска `npm test` прошли этот сценарий. |
| L-1. Нет диагностики excluded/invalid paths | **Исправлено и проверено** | `src/projection.ts:182-193` санитизирует и ограничивает diagnostic session ID; `src/projection.ts:214-234` пишет warning для malformed metadata и unsupported directory; конфликтующие directory и пустой title используют тот же безопасный ID в `src/projection.ts:261-283`. `tests/unit/projection.test.ts:192-212` подтверждает сохранение валидной записи, наличие warnings и отсутствие внедрённого newline. Extension ограничивает общий поток warnings до 100 записей: `src/extension.ts:41-52`. |
| L-2. Timeout docs не совпадают с runtime | **Исправлено и проверено** | `docs/sqlite-runtime-decision.md:9-20` теперь фиксирует worker thread и `timeout: 5000`; это совпадает с `src/kiloDataSource.ts:7-11` и тестом `tests/unit/kiloDataSource.test.ts:257-277`. Документ также отдельно фиксирует проверку responsiveness в `docs/sqlite-runtime-decision.md:34-44`. Последние замеры bounded busy завершились примерно за `6.8-7.3 s`, то есть в прежней тестовой границе `4.5-7.5 s`. |

Новых Critical/High findings в целевом remediation diff не обнаружено.

### Worker/thread behavior

- **Source behavior подтверждено.** `readKiloSessions` стал асинхронной границей и создаёт отдельный `Worker` с heap limit `64 MB`, outer timeout `10000 ms` и обработкой `message/error/exit`: `src/kiloDataSource.ts:274-335`.
- **SQLite isolation подтверждено.** В production path синхронные `DatabaseSync`, schema guard и metadata query вызываются через `readKiloSessionsInCurrentThread` из `src/kiloDataWorker.ts:1-27`; extension ожидает результат worker через `await`: `src/extension.ts:57-65`. Unit tests вызывают thread-local функцию напрямую только на временных fixtures.
- **Event-loop responsiveness подтверждено на unit runtime.** `tests/unit/kiloDataSource.test.ts:279-301` удерживает exclusive lock, запускает worker read и проверяет, что таймер main thread срабатывает до bounded `SQLITE_BUSY`. Последний прогон: timer assertion прошёл, worker error получен примерно через `6.9 s`.
- **Development Extension Host подтверждён частично.** `npm test` собрал `build/extension.js` и `build/kiloDataWorker.js`, затем завершил Extension Host VS Code `1.105.1` с code `0`. Лог содержит отдельные загрузки experimental `node:sqlite`, а refresh fixture не изменил DB. Однако host test по-прежнему не инспектирует фактическую модель после refresh, поэтому успешное отображение результата worker остаётся более узким доказательством, чем полный UI acceptance.
- **Ресурсы ограничены.** Worker возвращает только metadata/warnings; adapter ограничивает warnings, ID/title/directory lengths и закрывает connection в прежнем `finally`. Availability checks дополнительно ограничены максимум 16 параллельными операциями: `src/projection.ts:300-335`, `tests/unit/projection.test.ts:214-240`.

### Package gate после worker remediation

Текущий source/build и находящийся в `dist/` VSIX относятся к разным snapshots:

- `npm run verify:vsix` завершился ошибкой, потому что существующий архив не содержит обязательный `extension/build/kiloDataWorker.js`.
- Текущий архив содержит семь старых entries; новый exact allow-list ожидает восемь, включая worker: `scripts/verify-vsix.ps1:11-26`.
- SHA-256 текущего `build/extension.js`: `410BBDBF6858CD3D805AF2407BFEE6525899D2AEDF1BB64424A0EDA7CB220A62`.
- SHA-256 `extension/build/extension.js` в существующем VSIX: `69D4C4CAEB9D3576797FDD61090BA04173B04C7EB71AB93985E62027725DC3F6`.
- SHA-256 нового `build/kiloDataWorker.js`: `572C58BE2870E9FCD292E5F3E5ABDD5842F48658E900D1B5DB1F2A27BFB53D76`; соответствующего entry в архиве нет.
- `npm run test:installed` завершился с code `0`, но установил этот старый VSIX. Результат подтверждает старый установленный пакет, а не текущую worker remediation, и не закрывает P-005/P-006.
- `scripts/package.mjs` намеренно требует clean Git tree, поэтому новая упаковка текущих uncommitted changes в ходе этого ревью не выполнялась.

Итог по worker remediation: **реализация и development-host проверки прошли, installed-VSIX proof не пройден до чистой пересборки пакета с worker entry**.

### Новые результаты команд

- `npm test` — успешно на финальном проверенном snapshot: typecheck, ESLint, 26/26 unit tests, два production bundles и Extension Host VS Code `1.105.1`, exit code `0`.
- `npm run verify:vsix` — ожидаемо неуспешно для устаревшего артефакта: отсутствует `extension/build/kiloDataWorker.js`.
- `npm run test:installed` — exit code `0`, но результат не засчитан для remediation из-за доказанного несовпадения установленного VSIX с текущим build.
- `npm ls --omit=dev --all` — production dependency tree пуст.
- `git diff --check` — exit code `0`; только предупреждения LF/CRLF.

Повторное ревью закрывает M-1, L-1 и L-2. Общая приёмка Step 1 остаётся открытой до clean package rebuild, успешного exact VSIX verification и installed smoke именно нового worker-содержащего артефакта.

## Финальная проверка clean VSIX

Package blocker из предыдущего раздела **закрыт** на commit `e777265`.

- `npm test` прошёл единым финальным прогоном: typecheck, ESLint, 27/27 unit tests и Extension Host VS Code `1.105.1`, exit code `0`.
- Schema guard теперь требует для `session.id` реальную primary-key semantics (`pk > 0`), а отрицательный тест отклоняет `id TEXT NOT NULL` без PRIMARY KEY: `src/kiloDataSource.ts:26-36`, `src/kiloDataSource.ts:178-215`, `tests/unit/kiloDataSource.test.ts:176-211`.
- Metadata-only live worker успешно прочитал `31` root/non-archived sessions из текущей совместимой Kilo DB.
- `npm run verify:vsix` прошёл exact allow-list и сверку current bundle: пакет содержит восемь entries, включая `extension/build/kiloDataWorker.js`; размер `12857` bytes, SHA-256 `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`.
- `npm run test:installed` прошёл: runner сначала повторно проверил этот VSIX, установил его в изолированные profile/extensions directories, подтвердил `local.kilo-hub@0.1.0` и завершил installed Extension Host test с code `0`.

Остаются только residual manual gaps, которые automated runner намеренно не закрывает:

- визуальный осмотр Activity Bar, collapsed/expanded tree, порядка path/actions/conversations, длинных и non-ASCII titles, tooltips, missing и error states;
- фактические действия `Open Here`, `Open in New Window` и `Open in File Explorer` в изолированных окнах, включая блокировку missing path;
- ручной UI-flow create/rename/delete/delete-last + `Refresh` и выбор conversation node без навигации.

Итог: code findings и package/installed worker blocker закрыты; residual scope ограничен ручным визуальным и action smoke.
