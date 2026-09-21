# Повторное независимое ревью production-тестируемости и packaging Step 2

## Паспорт

- Проверенный source commit: `c5cd72b97a58ef991cf1abc73e7cb27c185d44fe` (`fix: resolve Step 2 production review findings`).
- Область: повторная проверка `reviews/step2-production-testability-review.md`, `reviews/step2-production-remediation.md`, test/build/package/release/verifier scripts, `req/step2/03-test-matrix.md` и `specs/step2-implementation-plan.md`.
- Среда: Windows `win32-x64`, Node.js `v24.13.0`, npm `11.6.2`.
- До создания этого отчёта tracked/untracked tree был чистым; `git diff --check` прошёл.
- `dist/kilo-hub-0.2.0-win32-x64.vsix` отсутствует. По ограничению задачи `npm run package`, `package:repro`, negative verifier и installed tests не запускались.
- Старый `0.1.0` не использовался как evidence Step 2.

## Findings

### HIGH-01 — installed smoke всё ещё не гарантирует наблюдение реального browser `ready`

**Ссылки:** `src/kiloHubWebviewProvider.ts:197-220`, `src/kiloHubWebviewProvider.ts:260-265`, `tests/integration/index.ts:378-381`, `tests/integration/index.ts:404-409`, `scripts/run-installed-extension-tests.mjs:72-88`, `req/step2/03-test-matrix.md:59`.

Remediation добавил реальный `ready` и bounded wait, однако `waitForBrowserReady()` немедленно возвращает success, если `this.view === undefined`. Общий integration/installed test открывает container и затем вызывает `kiloHub.refresh`, но не имеет отдельного наблюдаемого утверждения, что установленный provider уже получил `resolveWebviewView` и именно packaged browser прислал `ready`. При гонке или невозможности создать view refresh способен пройти через ветку `view === undefined`, выполнить worker read и дать зелёный installed smoke без browser handshake.

Динамический Current Stable прогон дополнительно показал нестабильность этой границы: первый `npm run test:integration:current` завершился `exit 1` с `Webview Kilo Hub не ответил в течение 5000 ms`; повтор с `NODE_TLS_REJECT_UNAUTHORIZED=1` завершился `exit 0`. Отказ является fail-closed, но один успешный повтор не устраняет ложноположительную ветку без resolved view и не даёт устойчивого release evidence.

**Disposition исходного HIGH-02:** частично исправлен, остаётся открытым как `High`. Нужен test-only наблюдаемый сигнал resolved-view/ready либо изменение refresh gate: требовать активный resolved view для installed handshake и отдельно проверить timeout при отсутствующем/неисполняемом packaged bundle. Финальный installed результат всё равно pending до VSIX.

### MEDIUM-01 — release orchestrator не выполняет требуемые clean/full/repro циклы

**Ссылки:** `scripts/release.mjs:10-19`, `scripts/clean.mjs:3-6`, `scripts/verify-reproducible-package.mjs:10-22`, `package.json:94-107`, `tsconfig.tests.json:5-15`, `specs/step2-implementation-plan.md:221`.

`release.mjs` выполняет один `npm ci`, audit и full tests, но не вызывает `npm run clean`. `build.mjs` очищает только `build/`; `build:tests` компилирует в существующий `build-tests/` без предварительного удаления. Поэтому release gate не доказывает отсутствие stale compiled tests. `package:repro` затем только дважды вызывает низкоуровневый `npm run package`: оба package-прогона очищают `build/`, но не являются двумя требуемыми независимыми циклами `npm ci → clean → full test → package`.

Сравнение двух SHA-256 в одном окружении реализовано корректно, но orchestration уже описанного M8 не выполнено. Нужна явная очистка до test/build и два полных цикла либо синхронизация плана с доказанно достаточным более узким контрактом.

**Disposition:** новое `Medium` finding; одновременно это незакрытый остаток исходного MEDIUM-04.

### MEDIUM-02 — exact verifier не фиксирует `engines.node`

**Ссылки:** `package.json:9-13`, `package-lock.json:23-26`, `.nvmrc:1`, `scripts/verify-vsix.ps1:51-65`, `req/step2/03-test-matrix.md:57`, `specs/step2-implementation-plan.md:219`.

Source и lockfile теперь согласованы: runtime floor `>=22.19.0 <25`, build pin `.nvmrc=22.20.0`, `engines.vscode=^1.105.1`, версия `0.2.0`. Verifier жёстко фиксирует `0.2.0` и `engines.vscode`, но не проверяет packaged `engines.node`. Архив с изменённым только `engines.node` и сохранённой identity/version пройдёт текущие manifest assertions. Это не соответствует заявленной exact-проверке identity/version/target/engine.

**Disposition:** новое `Medium` finding; добавить exact assertion packaged/source/fixed policy для `engines.node` и negative case manifest mutation.

### MEDIUM-03 — обязательная traceability source requirements остаётся незавершённой

**Ссылки:** `specs/step2-implementation-plan.md:188-194`, `req/step2/03-test-matrix.md:23-60`.

Targeted suites действительно покрывают исправленные performance, CSP, CSS, focus, protocol и backend regressions, но M6 по-прежнему оставляет незакрытым пункт о ссылке каждой строки матрицы на конкретный automated test либо manual ID. Сама матрица описывает будущий тип evidence и для большинства строк сохраняет статус `Production: требуется`; она не является исполнимой картой текущих test names/results. Поэтому зелёные агрегированные счётчики нельзя считать доказательством полной source traceability всей матрицы.

**Disposition:** новое `Medium` finding. До release нужен актуальный mapping каждого ID на точный тест/ручной пункт и статус; обязательные manual/installed строки должны оставаться `не проверено`, а не автоматически пройдено.

## Disposition исходных findings

| Исходный finding | Disposition на `c5cd72b` | Evidence |
| --- | --- | --- |
| BLOCKER-01: нет единого `0.2.0` release candidate | **Открыт / pending release gate** | VSIX отсутствует; exact/repro/install не запускались и не заявляются. |
| HIGH-01: нет browser heartbeat/chunking | **Исправлен** | `tests/component/webviewMain.test.ts:523-583`: 1000 folders, busy до heartbeat, полный render и отмена stale revision; component `29/29`. |
| HIGH-02: installed runner не доказывает browser handshake | **Частично исправлен, High открыт** | `ready`/timeout реализованы, но `src/kiloHubWebviewProvider.ts:200-201` разрешает refresh без resolved view; первый Current прогон timeout, второй pass; installed evidence отсутствует. |
| HIGH-03: нет exact CSP/bundle negative gate | **Исправлен в source scope** | Exact CSP/nonce/local root assertions в `tests/integration/index.ts:203-219`; `verify:webview-bundle` сканирует собранный JS и прошёл. Реальный CSP установленного VSIX остаётся M8/M9. |
| HIGH-04: component suite не покрывает CSS/bundle contracts | **Исправлен в допустимом automated scope** | `stylesContract.test.ts` проверяет source CSS B=13/16/20, 260/320/400, overflow/focus/forced-colors/motion; build и browser bundle scan прошли. Реальная geometry/zoom/NVDA корректно остаётся manual. |
| HIGH-05: current/path/action authorization race | **Исправлен** | Integration tests покрывают fresh workspace, revision и final-guard races; связанные production changes находятся в `c5cd72b`. GUI side effects остаются manual по матрице. |
| MEDIUM-01: path дублировался в accessible name | **Исправлен** | Component test разделяет `aria-label` и stable path `aria-describedby`, включая hostile path. |
| MEDIUM-02: удалённый focused target без fallback | **Исправлен** | Component test проверяет fallback same-folder → nearest-folder → refresh. |
| MEDIUM-03: Node floor и только minimum runner | **Исправлен на source/dev уровне** | Manifest/lockfile используют `>=22.19.0 <25`, `.nvmrc=22.20.0`; runners параметризованы. VS Code `1.105.1` прошёл; Current `1.138.0` дал один timeout и один pass. Installed min/current pending вместе с BLOCKER-01. |
| MEDIUM-04: version/verifier/negative/repro orchestration | **Частично исправлен** | Fixed `0.2.0`, exact entries/four hashes и negative scripts реализованы. Остатки вынесены в новые MEDIUM-01 и MEDIUM-02; фактическое выполнение package-dependent gates pending. |

## Подтверждённые свойства

- `scripts/build.mjs` перед сборкой рекурсивно удаляет `build/`, создаёт отдельные host/worker outputs и изолированные `build/webview/webview.js`/`webview.css`; browser target использует `platform: browser`, без source maps.
- `localResourceRoots` ограничен `build/webview`; CSP/nonce и URI production assets проверяются integration test.
- Browser render на 1000 folders действительно уступает event loop, показывает busy до chunks и отменяет stale render.
- Source version/lockfile version равны `0.2.0`; minimum VS Code engine равен `^1.105.1`; Node runtime floor согласован с Extension Host `1.105.1`.
- `verify-vsix.ps1` задаёт exact список десяти ZIP entries, фиксирует `0.2.0`, identity, target, `engines.vscode`, activation/view/commands и SHA-256 четырёх build outputs.
- Negative harness изменяет extra entry, удаляет browser JS и заменяет browser JS stale payload. Его фактический прогон корректно отложен до появления baseline VSIX.
- `vsce ls --tree` выбрал только восемь extension payload entries: license, manifest, четыре build assets, release notes и icon. Tests, fixtures, requirements, reviews, source maps и `node_modules` не выбраны.
- Runtime npm dependency tree пуст; secure-TLS audit сообщил `0 vulnerabilities`.

## Выполненные проверки

| Команда | Результат |
| --- | --- |
| `git status --short` до отчёта | Чисто |
| `git diff --check` | Успешно |
| `npm run check-types` | Успешно |
| `npm run lint` | Успешно |
| `npm run test:unit` | Успешно, `57/57` |
| `npm run test:component` | Успешно, `29/29`; 1000-folder render около `2.79 s`, без SLA |
| `npm run bundle` | Успешно; четыре ожидаемых outputs |
| `npm run verify:webview-bundle` | Успешно, scan `32044` bytes |
| `npm run test:integration:min` | Успешно, VS Code `1.105.1`, exit `0` |
| `npm run test:integration:current` | Первый прогон VS Code `1.138.0`: timeout browser `ready`, exit `1` |
| `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:integration:current` | Повторный прогон VS Code `1.138.0`: exit `0` |
| `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` | Успешно, `0 vulnerabilities` |
| `npm ls --omit=dev --all` | Пустое runtime tree |
| `npm exec -- vsce ls --tree` | Только ожидаемый production payload |

Не запускались: `npm run package`, `npm run package:repro`, `npm run test:verify-vsix-negative`, `npm run verify:vsix`, `npm run test:installed:min`, `npm run test:installed:current`, `npm run release`. Причина: Step 2 VSIX отсутствует, а финальная упаковка прямо исключена задачей.

## Итог

Исходные source-level performance/CSP/CSS/accessibility/action findings в основном исправлены и подтверждены тестами. Release exit не достигнут.

Открыто на этом этапе: `Blocker=1`, `High=1`, `Medium=3`, `Low=0`.

- `Blocker`: отсутствует единый exact-verified `0.2.0` VSIX и связанное repro/install evidence.
- `High`: installed test допускает обход реального browser-ready доказательства при unresolved view.
- `Medium`: release не выполняет требуемые clean/full независимые циклы; verifier не фиксирует `engines.node`; полная traceability матрицы не оформлена.

Новых findings: `High=0`, `Medium=3`, `Low=0`; открытый High является незакрытым остатком исходного HIGH-02. До исправления High и dispositions новых Medium commit `c5cd72b` не проходит testability/package review exit. Даже после source fixes финальный package/repro/exact/install gate остаётся обязательным отдельным этапом.
