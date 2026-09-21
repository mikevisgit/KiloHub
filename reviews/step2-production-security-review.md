# Независимое security/read-only/CSP review Step 2

## Findings

### MEDIUM-01 — действие авторизуется по устаревающему current/snapshot и не защищено от TOCTOU ревизии

**Файлы:** `src/kiloHubWebviewProvider.ts:216-231`, `src/commands.ts:53-89`, `src/extension.ts:76-78`.

**Evidence:** `handleFolderAction()` один раз сравнивает `message.revision` с `this.state.revision`, находит папку в `this.folders`/`this.state.folders` и доверяет сохранённому `folderDto.current`. Перед действием он не вызывает `workspaceDescriptor()`/`resolveCurrentFolder()` заново, хотя нормативный контракт требует повторного current resolver. Затем управление передаётся в `executeFolderAction()`, где выполняется асинхронный `isAvailableLocalDirectory(..., 2_000)`, после которого нет повторной проверки revision, принадлежности папки текущему snapshot или action matrix.

Есть два воспроизводимых по коду окна гонки:

1. workspace уже сменился, но асинхронный `workspaceChanged()` ещё не опубликовал новую presentation; `openHere`/`openNewWindow` разрешаются по прежнему `current=false`;
2. action прошёл начальную проверку, затем во время `stat`/`realpath` успешный refresh меняет revision или удаляет папку, но старый `KiloFolder` всё равно доходит до `vscode.openFolder`/`openExternal`.

Текущий integration test проверяет только stale revision до входа в action и последовательную смену workspace (`tests/integration/index.ts:166-178`), но не deferred races между проверкой и side effect.

**Влияние:** stale browser action может выполнить изменение workspace или открыть Explorer по папке, которая уже не разрешена актуальным snapshot/current-состоянием. Webview не получает произвольный path, поэтому это не arbitrary-command primitive, но это нарушение host authorization boundary `PROTO-03`/`ACT-02`.

**Требуемое исправление:** единый host-authorizer должен непосредственно перед side effect заново разрешать workspace/current, сверять generation/revision и ID с актуальным domain snapshot, проверять action matrix, выполнять path probe и после всех `await` повторно удостоверяться, что generation не изменилась. Нужны deferred tests на workspace change, refresh success/removal и dispose во время action.

**Disposition:** открыт.

### MEDIUM-02 — проверка local path не исключает первоначальный network access и открывает исходный, а не проверенный target

**Файлы:** `src/windowsPathSafety.ts:4-35`, `src/commands.ts:35-46`, `src/commands.ts:58-85`, `src/kiloDataSource.ts:77-137`, `src/kiloDataSource.ts:163-174`.

**Evidence:** `isAvailableLocalDirectory()` параллельно запускает `stat(path)` и `realpath(path)`, а timeout реализован через `Promise.race`; проигравшие filesystem operations не отменяются. Для определения UNC/reparse target Windows уже может обратиться к network provider. `isLocalResolvedWindowsPath()` принимает extended drive form `\\?\Z:\...`, поэтому mapped drive не обязательно распознаётся как сеть. Database path вообще открывается после лексической drive-letter проверки без `realpath`/drive-type guard. После успешной command-проверки код отбрасывает `resolved` и передаёт в VS Code URI исходного path, оставляя junction/reparse swap между check и use.

Это тот же остаточный риск, который был принят для Step 1 в `reviews/read-only-security-review.md:169-177` и записан в `handoff.md:88-90`; Step 2 его не устранил. Unit test проверяет только строковые local/UNC формы и обычный temp directory (`tests/unit/windowsPathSafety.test.ts:12-26`), но не реальный mapped drive, junction/reparse target, незавершённый I/O после timeout или swap target.

**Влияние:** refresh/command/database open могут инициировать SMB/network resolution и Windows credential negotiation вопреки заявленной offline/local границе; гонка может открыть target, отличный от проверенного.

**Требуемое исправление:** применить документированную Windows drive/reparse policy до автоматического обхода, изолировать или реально отменять filesystem probe, возвращать и использовать проверенный resolved local target, распространить ту же policy на database path и добавить Windows integration tests. Если первичный network lookup физически неизбежен, ограничение должно быть заново принято для Step 2, а не считаться закрытым прошлым review.

**Disposition:** открыт как унаследованный Medium residual.

### MEDIUM-03 — несовместимые лимиты adapter и Webview DTO позволяют одной metadata-строке сорвать весь snapshot

**Файлы:** `src/kiloDataSource.ts:229-258`, `src/presentation.ts:352-413`, `src/webviewProtocol.ts:3-10`, `src/webviewProtocol.ts:211-253`, `src/webviewState.ts:35-58`, `src/kiloHubWebviewProvider.ts:158-175`.

**Evidence:** adapter принимает `title` и `directory` длиной до `32 768`. Folder ID затем равен нормализованному path. Protocol допускает ID только до `1 024`, display text до `4 096`, path до `32 767` и не более `10 000` folders. Presenter не обрезает, не изолирует и не отклоняет несовместимую папку/title до атомарной замены. `copyFolders()` валидирует весь массив через `isHubFolderArray()` и бросает `TypeError`, после чего весь refresh переходит в error/stale state.

Targeted read-only reproduction на собранных tests с одним title длиной `4097` завершился: `TypeError: Invalid Hub folder DTO snapshot.` Аналогичный отказ возможен для folder ID/path и для числа папок больше `10 000`. Существующие tests проверяют protocol limits отдельно, но не end-to-end согласованность adapter → projection → presenter → state.

**Влияние:** одна schema-valid, но длинная локальная metadata-запись либо достаточно большая база делает весь Hub недоступным, а не только проблемную запись. Это local availability vector и нарушение malformed-row isolation.

**Требуемое исправление:** определить один согласованный budget на boundary до создания domain snapshot; безопасно изолировать/диагностировать неподдерживаемую строку или формировать bounded display DTO без изменения source. Добавить end-to-end tests на точные границы ID/path/name/title/folder count и сохранение остальных валидных папок.

**Disposition:** открыт.

### MEDIUM-04 — resource bounds не замкнуты от SQLite до DOM, browser render выполняется монолитно

**Файлы:** `src/kiloDataSource.ts:268-286`, `src/kiloDataSource.ts:300-349`, `src/kiloDataWorker.ts:14-28`, `src/projection.ts:278-337`, `src/webviewProtocol.ts:3-10`, `src/webview/main.ts:675-721`.

**Evidence:** SQL использует `.all()` без row/result budget и полностью материализует строки до их проверки. Worker ограничен `64 MB` old generation и `10 000 ms`, но это не полный RSS/native-memory limit; весь результат клонируется одним `postMessage`. Timeout вызывает `void worker.terminate()` без ожидания завершения. После worker projection может последовательно проходить произвольное число групп через 16 workers доступности, а timeout каждого `stat`/`realpath` не отменяет I/O. Browser принимает до `10 000` folders и синхронно в одном вызове `renderState()` создаёт/обновляет все карточки, кнопки и tooltip nodes без event-loop yield.

Regression на 1 000 sessions покрывает presenter/projection, но component suite не отправляет большой snapshot и не проверяет heartbeat/chunked render. Это не выполняет обязательный chunked-render инвариант плана `M4/M6` и сохраняет два Step 1 residuals, зафиксированных в `reviews/read-only-security-review.md:175-177`.

**Влияние:** большая или специально сформированная schema-compatible локальная база может вызвать memory pressure Extension Host, накопление незавершённых filesystem operations и длительное зависание Webview. CSP и worker изолируют часть последствий, но не создают end-to-end budget.

**Требуемое исправление:** ввести явный row/byte/result budget до полной передачи, итеративное чтение либо доказанно bounded failure, завершать worker termination, сделать availability probes отменяемыми/изолированными и рендерить DOM порциями с heartbeat test на нормативной большой fixture.

**Disposition:** открыт; backend-часть ранее принималась только для Step 1 и требует явного Step 2 disposition.

### LOW-01 — dispose/revive не инвалидирует view generation и допускает postMessage в устаревший view

**Файлы:** `src/kiloHubWebviewProvider.ts:48-63`, `src/kiloHubWebviewProvider.ts:70-91`, `src/kiloHubWebviewProvider.ts:152-175`, `src/kiloHubWebviewProvider.ts:234-241`.

**Evidence:** `dispose()` удаляет subscriptions, но не очищает `this.view`, не сбрасывает `browserReady` и не инвалидирует выполняющийся refresh. `publishState()` не захватывает/сверяет generation конкретного view. Publication, начатая до replacement/dispose, может завершиться на старом `Webview`; refresh, завершившийся после provider dispose, снова вызывает publication. Тестов dispose/revive с deferred `postMessage`/`loadFolders` нет.

**Влияние:** metadata snapshot может быть предложен устаревшему Webview, а lifecycle создаёт лишние side effects/логи. Обычно disposed Webview отклонит сообщение, поэтому severity низкая.

**Требуемое исправление:** generation token, очистка `view`/`browserReady` в `dispose()`, проверка captured view/generation до и после `postMessage`, deferred lifecycle tests.

**Disposition:** открыт.

### LOW-02 — Output и notifications раскрывают полные локальные пути

**Файлы:** `src/commands.ts:58-89`, `src/kiloHubWebviewProvider.ts:167-174`, `src/extension.ts:89-92`, `src/kiloDataWorker.ts:18-25`.

**Evidence:** command errors записывают `folder.path`/`uri.fsPath` в Output и показывают полный path в notification. Worker передаёт полный stack, который может содержать database/user-profile path; host пишет stack в Output. Titles и message bodies в логи не попадают, warning count ограничен, но path является пользовательской metadata и может попасть в diagnostic export или screen sharing.

**Влияние:** локальные имена пользователя/проектов раскрываются за пределами самой карточки Hub в диагностической поверхности VS Code.

**Требуемое исправление:** оставить техническую причину в Output, но редактировать home/project prefix либо логировать stable diagnostic code; notification не должна включать полный path без необходимости. Зафиксировать privacy policy диагностик.

**Disposition:** открыт либо требует явного принятия как privacy limitation.

### LOW-03 — CSP/local-resource/package controls не закреплены exact negative tests

**Файлы:** `src/webviewHtml.ts:5-34`, `src/kiloHubWebviewProvider.ts:75-79`, `tests/integration/index.ts:154-159`, `scripts/verify-vsix.ps1:12-110`.

**Evidence:** текущий HTML вручную содержит криптографический nonce, `default-src 'none'`, `connect-src 'none'`, `img-src 'none'`, nonce-only script и local stylesheet. Однако integration test проверяет только наличие строки `Content-Security-Policy` и имён двух assets, а не exact directives, nonce correspondence/uniqueness, отсутствие inline handler или network source. `localResourceRoots` разрешает весь `build/`, включая host `extension.js` и worker, хотя Webview нужны только `webview.js`/`webview.css`. Negative tests exact verifier для extra/missing/stale asset в просмотренном suite отсутствуют.

**Влияние:** текущая CSP не имеет найденного bypass, но её ослабление или расширение resource surface может незаметно пройти suite. Широкий root увеличивает доступную Webview resource surface.

**Требуемое исправление:** вынести browser assets в отдельный каталог/root, добавить exact CSP parser/nonce tests, scans итогового browser bundle и negative verifier tests на extra/missing/mutated asset.

**Disposition:** открыт как defense-in-depth/test-evidence gap.

## Подтверждённые свойства

- Проверен commit `b324982cedc2527826ffc2d74e54dff984abfeac`; `HEAD` совпадал с ним.
- SQLite открывается с `readOnly: true`, `allowExtension: false`, timeout `5 000 ms` и connection-local `PRAGMA query_only = ON`; connection закрывается в `finally`.
- Production SQL выбирает только семь metadata columns таблицы `session`, только `parent_id IS NULL` и `time_archived IS NULL`. Обращений к message/content tables и чтения файлов проектов не найдено.
- Записывающих filesystem/storage API в `src/` не найдено. Постоянное состояние Webview содержит только version, 32-bit key раскрытой папки и scrollTop; folder/path/title/snapshot не сохраняются. Domain snapshot остаётся только в памяти host.
- Browser DTO не содержит URI для исполнения или command ID. Browser action содержит только protocol version, revision, folder ID и enum action; path берётся из host snapshot.
- Runtime validators требуют plain object/array, exact own keys, data descriptors, bounds и safe integer revision; accessor/prototype/symbol/sparse shapes отклоняются без вызова getter. Для реального VS Code channel structured clone дополнительно не переносит Proxy/accessor semantics.
- Пользовательские name/path/title создаются DOM API и `textContent`; `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` и `new Function` в production source не найдены. Hostile HTML component test не создаёт `img`/`script`.
- Browser source не содержит `fetch`, XHR, WebSocket, EventSource, beacon, storage API или Node imports. CSP запрещает network/connect/images и внешние/default resources.
- Nonce создаётся `randomBytes(18)` для каждого HTML; script URI и stylesheet URI строятся через `asWebviewUri`. Динамический theme CSS записывается только из вычисленных numeric RGB/internal slot values в nonce-bearing `<style>`.
- External command IDs папок зарегистрированы, но `resolveFolderCommandReference()` всегда возвращает `undefined`; внешнее непроверенное command argument не даёт path/action execution. Webview вызывает executor напрямую только после host checks.
- `npm ls --omit=dev --all` показал пустое runtime dependency tree. Lockfile содержит `0` non-dev packages; production VSIX не должен включать `node_modules`.
- `vsce ls --tree` выбрал только `LICENSE.txt`, `package.json`, четыре `build` assets, `docs/release-notes.md` и `resources/hub.svg`; requirements/tests/fixtures/reviews/source maps в source package selection не попали.

## Проверки

Среда: Node `v24.13.0`, npm `11.6.2`, Windows; integration Extension Host использовал VS Code `1.105.1`, Node `22.19.0`, Electron `37.6.0`.

- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` — `0 vulnerabilities`.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm test` — typecheck и ESLint прошли; unit `54/54`, component `20/20`, development Extension Host exit code `0`.
- Unit adapter evidence повторно подтвердило read-only/query-only, отсутствие изменений DB, WAL visibility, bounded busy wait и responsive main event loop.
- Static `git grep` по production source не нашёл network/storage write/raw-HTML/dynamic-code API; data-read scan нашёл только SQLite metadata и `stat`/`realpath`.
- Built browser/source scan не выявил Node/SQLite/project/message-content imports или source maps; initial `rg` invocation был недоступен в `PATH`, поэтому использованы repository `git grep` и специализированный content scan.
- Targeted limit reproduction с title длиной `4097` — `TypeError: Invalid Hub folder DTO snapshot.`
- `node node_modules/@vscode/vsce/vsce ls --tree` — source package selection ограничен восемью extension payload files, перечисленными выше.
- `git show --check --oneline b324982` — прошёл.

`npm run verify:vsix`, installed-VSIX smoke и archive hash review не запускались: `dist/kilo-hub-0.2.0-win32-x64.vsix` отсутствует. Создавать новый artifact запрещено scope этой независимой проверки, а `npm run package` дополнительно требует clean tree.

## Остаточные риски и ограничения evidence

- Read-only WAL reader может менять технические read-marks существующего `kilo.db-shm`; DB/WAL/logical sessions не должны изменяться, но побайтовая неизменность SHM не заявляется.
- Schema guard проверяет форму семи columns, но не доказывает семантическую совместимость будущей Kilo schema с теми же declarations.
- `KILO_DB` является доверенным environment override и допускает абсолютный path и относительный traversal, повторяющий Kilo `path.resolve`; отдельной workspace-controlled boundary здесь не найдено, но override может направить reader не в стандартную базу.
- Strict CSP значительно снижает XSS impact, но не заменяет authorization: локальный browser bundle считается доверенным, а `onDidReceiveMessage` не имеет отдельного per-view capability token. VS Code channel привязан к конкретному Webview, exact validation/revision присутствуют; отдельный token является defense in depth, не текущим finding.
- Реальный Chrome/VS Code CSP enforcement, DevTools Network, malicious installed fixture, mapped drive/reparse behavior и GUI actions этим source review не проверены.
- Фактический VSIX surface, reproducibility, exact archive entries/hashes и установленный runtime остаются `не проверено` до появления одного release candidate `0.2.0`.
- Во время проверки появился чужой untracked `reviews/step2-production-requirements-review.md`; он не читался как evidence, не изменялся и не относится к source commit.

## Verdict

**Blocker: 0. High: 0. Medium: 4 открыты. Low: 3 открыты/требуют disposition.**

Commit сохраняет ключевую read-only/metadata-only границу, не читает тела сообщений или файлы проектов, не создаёт persistent metadata cache и не показывает найденного XSS/CSP/network primitive. Protocol shape/revision validation и DOM text handling существенно defensive.

Security review exit для Step 2 **не достигнут**: action authorization имеет stale/current TOCTOU, adapter/DTO limits дают атомарный denial, end-to-end resource bounds/chunked render отсутствуют, а унаследованный local-path/network residual остаётся. Кроме того, без VSIX `0.2.0` нельзя выдать package/installed verdict. После исправлений требуются targeted re-review затронутых областей и повтор полного suite на новом source commit/VSIX hash.
