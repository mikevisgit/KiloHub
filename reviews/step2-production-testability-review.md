# Независимое ревью production-тестируемости и packaging Step 2

## Findings

### BLOCKER-01 — отсутствует единый проверенный release candidate `0.2.0`

**Ссылки:** `specs/step2-implementation-plan.md:213-228`, `scripts/run-installed-extension-tests.mjs:9-35`, `scripts/package.mjs:4-53`, `req/step2/03-test-matrix.md:57-59`.

В `dist/` нет `kilo-hub-0.2.0-win32-x64.vsix`; существует только сохранённый Step 1 `0.1.0`. Поэтому для commit `b324982cedc2527826ffc2d74e54dff984abfeac` ещё не существуют exact-verification, два clean/repro прогона, SHA-256, isolated install и installed-host evidence одного `0.2.0` файла. Контрольный `npm run test:installed` ожидаемо остановился до установки: `verify-vsix.ps1` не нашёл `dist/kilo-hub-0.2.0-win32-x64.vsix`.

Это не дефект feature commit сам по себе и финальная упаковка намеренно не выполнялась в этом ревью, но release gate M8/PKG-01..03 остаётся заблокированным. Нельзя использовать успешный development Extension Host test как замену package/install evidence.

### HIGH-01 — performance-test не покрывает обязательный browser heartbeat, а production render остаётся синхронным

**Ссылки:** `src/webview/main.ts:675-713`, `tests/unit/presentation.test.ts:261-276`, `tests/unit/projection.test.ts:217-243`, `req/step2/03-test-matrix.md:56`, `specs/step2-implementation-plan.md:189`.

`renderState()` синхронно удаляет, создаёт, обновляет и переставляет все карточки до возврата event loop. Chunking/yield отсутствует. Тест с названием про 1000 conversations передаёт все 1000 sessions в одну папку и после presenter limit фактически рендерил бы только одну карточку с тремя строками; второй тест покрывает только projection 1000 sessions/100 folders. Ни один тест не запускает browser render большого snapshot, не доказывает появление busy до тяжёлой обработки и не имеет event-loop sentinel во время DOM-обновления.

Зелёный `PERF`-подобный результат является неполным доказательством: host worker не блокирует event loop, но browser Webview может блокировать его синхронным DOM render. Нужен component/browser regression на большой валидный envelope с heartbeat и проверкой всех folders, limit/actions/revision; production render должен уступать event loop порциями.

### HIGH-02 — installed runner не доказывает загрузку browser bundle и protocol handshake установленного Webview

**Ссылки:** `scripts/run-installed-extension-tests.mjs:62-70`, `tests/integration/index.ts:98-190`, `tests/integration/index.ts:203-206`, `tests/integration/index.ts:215-236`, `req/step2/03-test-matrix.md:59`.

Runner правильно ставит VSIX в отдельные каталоги, проверяет identity/version и запускает тестовый Extension Host. Но общий integration test:

- проверяет только наличие `build/webview.js` и `build/webview.css` в checkout;
- тестирует `KiloHubWebviewProvider` с mock `Webview`, mock `postMessage` и прямым импортом из `build-tests`;
- активирует установленное расширение и действительно проверяет packaged worker refresh через `kiloHub.refresh`, но не наблюдает реальный Webview browser context;
- не утверждает загрузку packaged `webview.js`/`webview.css`, выполнение bootstrap, browser `ready`, host state reply, отсутствие 404/CSP error или blank view.

Следовательно, будущий зелёный `test:installed` будет хорошим evidence identity/activation/worker, но ложноположительным, если его засчитать целиком за требование PKG-03 о browser asset load и initial protocol synchronization. Нужен наблюдаемый handshake либо отдельный честно обозначенный manual installed gate; mock-provider test не следует считать installed browser evidence.

### HIGH-03 — CSP и browser build policy не имеют требуемой exact/negative автоматической проверки

**Ссылки:** `src/webviewHtml.ts:9-32`, `scripts/build.mjs:19-38`, `tests/integration/index.ts:154-159`, `scripts/verify-vsix.ps1:12-110`, `req/step2/03-test-matrix.md:42-43`.

Production HTML фактически задаёт nonce, `default-src 'none'`, локальный stylesheet и запрещает `connect-src`/`img-src`; browser bundle собирается отдельно с `platform: 'browser'`, без sourcemap. Однако тест утверждает только наличие строки `Content-Security-Policy` и имён двух assets. Он пройдёт при добавлении `unsafe-inline`, `unsafe-eval`, внешнего origin, ослаблении `connect-src`, несовпавшем nonce или некорректной URI policy. Автоматического parser-теста exact directives, проверки nonce, `localResourceRoots`, запрещённых network API/imports и scan именно собранного `build/webview.js` нет.

В manifest VS Code отдельного поля CSP для `WebviewView` не требуется: политика корректно создаётся runtime HTML. Поэтому verifier архива не обязан искать несуществующее manifest-поле, но SEC-02 требует exact source/HTML test и forbidden-source scan. Ручной scan текущего bundle не нашёл Node imports, `require`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval` или source-map marker; это полезное evidence текущего состояния, но не regression gate.

### HIGH-04 — component suite на `happy-dom` не исполняет production CSS или browser bundle и не закрывает CSS/theme/accessibility contracts

**Ссылки:** `tests/component/webviewMain.test.ts:78-96`, `tests/component/tooltip.test.ts:214-239`, `tests/component/accordion.test.ts:188-286`, `src/webview/styles.css:1-385`, `req/step2/03-test-matrix.md:34-35`, `req/step2/03-test-matrix.md:49-55`.

Harness создаёт пустой document с одним `#app` и напрямую вызывает TypeScript-функцию `createWebviewApp`. Он не загружает `createWebviewHtml`, `build/webview.js` или `build/webview.css`. Геометрия tooltip/accordion полностью подставлена через fake rectangles, heights и scroll bounds. Поэтому `happy-dom` здесь хорошо проверяет DOM mutation, runtime validation и state transitions, но не может доказать:

- computed styles, CSS cascade и нормативные B=13/16/20 при 260/320/400;
- ellipsis, переносы, реальный overflow/scrollbar, viewport fit и zoom 200%;
- forced colors, четыре точные встроенные темы и фактические contrast pairs;
- нативный Tab-порядок, `inert`, focus painting, screen-reader/NVDA semantics;
- реальный layout во время 320 ms animation и scroll compensation.

Это известная граница DOM-эмуляции, а не требование заменить manual checklist. Но план дополнительно требует автоматический CSS/source contract и проверку production bundle; таких тестов сейчас нет. Нужны как минимум загрузка/scan фактических CSS и bundle outputs, проверка критических CSS declarations/tokens и явная traceability оставшихся geometry/NVDA пунктов только к manual IDs.

### HIGH-05 — host authorization не пересчитывает current перед действием, а тесты exact command path являются неполными

**Ссылки:** `src/kiloHubWebviewProvider.ts:216-232`, `src/commands.ts:53-89`, `tests/integration/index.ts:166-178`, `tests/integration/index.ts:229-236`, `req/step2/03-test-matrix.md:37`, `req/step2/03-test-matrix.md:40`.

Перед action provider проверяет revision, ID, snapshot availability и сохранённый `folderDto.current`, после чего вызывает executor. Fresh `stat/realpath` есть в `executeFolderAction`, но обязательный повторный current resolver непосредственно перед действием отсутствует. Между последней workspace publication и click состояние workspace может измениться, а stale open-action пройти по ещё актуальной revision.

Integration test сначала явно вызывает `provider.workspaceChanged()`, а потом action, поэтому race не покрывается. Он также проверяет только чистую функцию `openFolderOptions()`; реальные `vscode.commands.executeCommand('vscode.openFolder', uri, exactOptions)` и `vscode.env.openExternal(uri)` не перехватываются и не утверждаются. Нет negative tests для path changed after render, reparse/mapped-to-UNC и действия в момент workspace/revision race. Требуется единый authorizer с fresh workspace/current и path validation и observable adapter tests без открытия GUI.

### MEDIUM-01 — тест закрепляет дублирование полного пути в accessible name и description

**Ссылки:** `src/webview/main.ts:591-597`, `src/webview/main.ts:543-548`, `tests/component/webviewMain.test.ts:347-350`, `req/step2/ТЗ реализации дизайна VSIX.md:68`.

`updateFolderAria()` включает `Путь: <full path>` в `aria-label`, а tooltip-controller одновременно добавляет к той же кнопке постоянный `aria-describedby` на тот же полный путь. Канон требует имя из name/current/missing/date и path только как description. Текущий component test прямо ожидает path в `aria-label`, то есть превращает нарушение в зелёное утверждение. Для NVDA путь может объявляться дважды и перегружать каждую карточку.

Нужно убрать path из accessible name, сохранить stable `aria-describedby` и заменить тест на раздельные assertions name/description, включая две папки с одинаковым display name.

### MEDIUM-02 — удаление сфокусированной папки не имеет безопасного focus fallback

**Ссылки:** `src/webview/main.ts:658-713`, `tests/component/webviewMain.test.ts:185-225`, `req/step2/03-test-matrix.md:45`, `req/step2/04-manual-acceptance-checklist.md:134`.

Перед render сохраняется `data-key`; после удаления folder `restoreFocus()` ищет только тот же key и молча завершается, если его больше нет. Тест покрывает сохранение существующей папки, но не удаление сфокусированной header/action при successful refresh. Требование требует сброс на видимый безопасный элемент. Нужен fallback, например ближайшая существующая header либо refresh, и component test удаления expanded/focused target с сохранением корректного scroll.

### MEDIUM-03 — declared Node engine противоречит фактическому minimum Extension Host, Current VS Code не запускается

**Ссылки:** `package.json:9-13`, `package-lock.json:23-26`, `tests/integration/index.ts:193-200`, `scripts/run-extension-tests.mjs:10-18`, `scripts/run-installed-extension-tests.mjs:41-69`, `docs/release-notes.md:22-27`.

Manifest/lockfile объявляют Node `>=22.20.0 <25`, тогда как единственный минимальный Extension Host test специально подтверждает Node `22.19.0` и успешно исполняет runtime. Если `engines.node` предназначен для build tooling, он не должен одновременно выглядеть как runtime floor расширения, исключающий фактический поддерживаемый host. Build выполнен на Node `24.13.0`; minimum VS Code `1.105.1` прошёл development test.

Оба runner жёстко запускают только VS Code `1.105.1`. Требуемая проверка актуальной release-версии отсутствует, а `0.2.0` installed runner пока не запускался ни на minimum, ни на Current. Следует разделить build-tool pin и runtime compatibility statement, параметризовать VS Code version и записать два результата. Browser target `chrome138` согласован с проверенным Electron 37.6 minimum host, но фактический packaged browser bundle ещё не исполнялся.

### MEDIUM-04 — package verifier exact по entries, но не фиксирует `0.2.0` и не имеет обязательных negative tests

**Ссылки:** `package.json:5`, `package.json:25-31`, `scripts/verify-vsix.ps1:12-27`, `scripts/verify-vsix.ps1:39-49`, `scripts/verify-vsix.ps1:95-110`, `specs/step2-implementation-plan.md:217-226`.

Положительные свойства verifier хороши: он требует точные десять ZIP entries, target, view/commands/activation surface и совпадение четырёх build hashes. Однако version сравнивается только с текущим source manifest; если оба ошибочно имеют `0.3.0` или прежнюю версию, проверка пройдёт, хотя Step 2 требует ровно `0.2.0`. Не проверяются точные значения всего security-relevant manifest surface и нет автоматических negative cases extra/missing/stale/mutated asset, хотя M8 требует их явно.

`npm run package` также не включает `clean`, `npm ci` или full tests: это допустимо как низкоуровневая команда, но два независимых clean/repro цикла пока остаются ручной процедурой без исполнимого orchestrator/evidence. Перед release следует добавить fixed expected version, negative verifier harness и отдельный release runner, который делает clean/full gate и сравнивает два SHA-256, не ослабляя clean-tree check.

## Подтверждённые свойства

- Review выполнен для полного commit `b324982cedc2527826ffc2d74e54dff984abfeac`; tracked tree до создания этого отчёта был чистым.
- `npm audit --audit-level=high` с `NODE_TLS_REJECT_UNAUTHORIZED=1`: `0 vulnerabilities`.
- `npm ls --all`: missing/invalid/extraneous dependencies не обнаружены; сообщения `UNMET OPTIONAL DEPENDENCY` относятся к чужим platform binaries и ожидаемы на `win32-x64`.
- Все десять прямых зависимостей точно закреплены в lockfile v3 и являются `devDependencies`. Runtime npm dependencies, optional root dependencies и bundled dependencies отсутствуют.
- `happy-dom 20.14.5` имеет MIT license, используется только component tests и не выбран `files` allow-list.
- `npm exec -- vsce ls --tree` показал ровно восемь extension payload entries: `LICENSE.txt`, `package.json`, четыре `build/*` файла, release notes и `hub.svg`. Вместе с двумя служебными ZIP entries это совпадает с exact списком verifier. `tests`, fixtures, `req`, `reviews`, source maps, БД, sidecars и `node_modules` не выбираются.
- Host и worker bundles используют только project code, Node built-ins, external `vscode` и external `node:sqlite`; browser bundle собирается `platform: browser` и текущий scan не нашёл Node/network/eval imports. Третьестороннего runtime-кода в VSIX не выявлено.
- Проект объявлен `UNLICENSED`, а `LICENSE.txt` входит в package allow-list. При текущем составе отдельный runtime third-party notice не требуется; dev-tool licenses не распространяются внутри VSIX.
- `verify-vsix.ps1` ожидает `extension/build/extension.js`, `kiloDataWorker.js`, `webview.js`, `webview.css` и сравнивает каждый с текущим build output по SHA-256.
- Production CSP в просмотренном source использует криптографический nonce, `default-src 'none'`, local Webview stylesheet и отсутствие network connect. Finding HIGH-03 относится к отсутствию regression proof, а не к найденному ослаблению текущей строки CSP.

## Выполненные проверки

| Команда | Результат |
| --- | --- |
| `node --version` | `v24.13.0` |
| `npm --version` | `11.6.2` |
| `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` | Успешно, `0 vulnerabilities` |
| `npm ls --all` | Успешно |
| `npm exec -- vsce ls --tree` | Успешно, только ожидаемый production payload |
| `npm run bundle` | Успешно; четыре production outputs |
| `npm test` | Успешно: typecheck, lint, 54 unit, 20 component, development Extension Host VS Code `1.105.1` |
| `npm run test:installed` | Ожидаемо завершился до установки: нет `0.2.0` VSIX, exact verifier остановил runner |
| `git diff --check` | Успешно до создания отчёта |

Финальный `npm run package` не выполнялся по ограничению задачи. Clean checkout, два reproducible package-прогона, exact verifier реального `0.2.0`, installation и Current VS Code не заявляются.

## Итог

Открыто: `Blocker=1`, `High=5`, `Medium=4`, `Low=0`. Unit/backend база и отдельные DOM state machines сильные, audit и dependency/package allow-list находятся в хорошем состоянии. Commit нельзя использовать как release evidence Step 2 до устранения High findings, добавления недостающих автоматических контрактов и прохождения M8/M9 на одном exact-verified VSIX hash.
