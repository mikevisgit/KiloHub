# Финальное targeted re-review production-тестируемости Step 2

## Паспорт

- Проверенный source commit: `735f06afdd34baf89965308d91399beaf918b79b` (`fix: close Step 2 targeted review findings`).
- Область намеренно ограничена четырьмя открытыми пунктами `reviews/step2-production-testability-rereview.md`: unresolved-view/browser-ready gate, clean/repro release orchestration, exact `engines.node` с negative mutation и requirement → automated/manual traceability.
- Дополнительно проверены общий helper изоляции test host и фактические minimum/current development runs.
- Среда: Windows `win32-x64`, Node.js `v24.13.0`, npm `11.6.2`.
- На старте tracked/untracked tree был чистым. Во время проверки параллельно появился чужой untracked review-файл; он не читался как evidence и не изменялся.
- `dist/kilo-hub-0.2.0-win32-x64.vsix` отсутствует. По ограничению задачи VSIX не создавался; package-dependent negative/install gates не запускались.

## Findings

### MEDIUM-01 — traceability содержит несуществующие manual ID и неточные automated claims

**Ссылки:** `req/step2/03-test-matrix.md:63-104`, `req/step2/04-manual-acceptance-checklist.md:38-179`, `tests/component/webviewMain.test.ts:364-404`, `src/webview/main.ts:541-554`, `specs/step2-implementation-plan.md:188`.

Новая таблица структурно содержит по одной строке для всех 36 requirement ID основной матрицы и явно оставляет package/manual evidence pending. Однако она пока не обеспечивает полную проверяемую ссылочную целостность:

- `DATA-02`, `ACT-01` и `PROTO-03` ссылаются на `M-MISS-01`, тогда как checklist содержит `M-MISSING-01` и `M-MISSING-02`;
- `PRES-01`, `VIEW-01` и `SCALE-01` ссылаются на отсутствующие `M-LAYOUT-*` и `M-ZOOM-*`; реальные геометрические пункты называются `M-SCALE-01..07`;
- `PRES-03` ссылается на диапазон `M-CURRENT-01..03`, но существуют только `M-CURRENT-01..02`;
- `ACC-02` и `ACC-03` ссылаются на отсутствующие `M-MOTION-01` и `M-SCROLL-01..03`; соответствующие реальные проверки находятся в `M-ACC-04..07`;
- `TIP-01` ссылается на отсутствующий `M-NVDA-01`; NVDA-проверки представлены группой `M-A11Y-*` и tooltip cases;
- ряд существующих пунктов checklist не связан с наиболее прямым requirement: например, `MONO-01` не указывает `M-MONO-01`, `VIEW-01` не указывает `M-HISTORY-01..02`, `PKG-02` указывает `M-PKG-01` вместо exact-content `M-PKG-02`, а `PKG-03` использует неточное «plus full checklist» вместо `M-PKG-03..05`;
- строка `MONO-01` заявляет `webviewMain.test.ts: monogram aria-hidden`, но component test не утверждает `aria-hidden` монограммы. Production-код действительно ставит атрибут в `src/webview/main.ts:543`, однако это source observation, а не заявленный test evidence.

Тем самым прежний MEDIUM-03 закрыт только структурно, но не семантически. Нужна автоматическая либо независимая сверка всех развёрнутых manual ID с реально объявленными ID, замена ошибочных диапазонов и соответствие каждого automated claim фактическому assertion/test name.

**Disposition:** прежний `Medium` остаётся открытым. Это уточнение исходного finding, а не новый отдельный finding.

## Disposition открытых пунктов прошлого re-review

| Пункт | Disposition на `735f06a` | Evidence |
| --- | --- | --- |
| HIGH: refresh/installed smoke мог пройти без resolved view и browser `ready` | **Исправлен** | `ensureResolvedView()` раскрывает container и bounded-ожидает фактический `resolveWebviewView`; отсутствие view и отсутствие `ready` fail-closed до чтения. `testRefreshRequiresResolvedWebview` получает reject и утверждает `reads === 0`. Minimum и Current runs прошли. Installed evidence всё ещё package pending. |
| MEDIUM: release не выполнял два clean/full/repro цикла | **Исправлен в orchestration source** | `scripts/release.mjs:27-42` дважды выполняет `npm ci → audit → clean → npm test → package`, сохраняет оба SHA-256 и отклоняет несовпадение. Затем запускаются Current, negative verifier и installed min/current. Фактическое выполнение отложено до VSIX. |
| MEDIUM: verifier не фиксировал `engines.node` и не имел mutation case | **Исправлен в verifier source** | `verify-vsix.ps1:62-64` требует exact `>=22.19.0 <25`; `test-vsix-verifier.ps1:48-60` заменяет packaged engine на `>=99` и требует reject. Выполнение negative case package pending. |
| MEDIUM: requirement → test/manual traceability отсутствовала | **Частично исправлен, Medium открыт** | Все 36 requirement ID имеют строки и pending-status, но manual references содержат несуществующие ID/диапазоны и как минимум один automated claim не подтверждён указанным test assertion. |
| BLOCKER: отсутствует единый exact-verified VSIX `0.2.0` | **Pending release gate, не source regression** | Артефакт отсутствует; package/repro/negative/install evidence намеренно не создавалось. |

## Browser-ready и test-host isolation

- `refresh()` теперь всегда проходит через `performRefreshAfterViewReady()`.
- Если view ещё нет, provider выполняет `workbench.view.extension.kiloHub`, bounded-ожидает создание view и отклоняет операцию без `loadFolders`, если view не появился.
- После resolved view отдельный bounded waiter требует versioned browser `ready`; dispose/replacement отклоняют waiter.
- Integration regression прямо доказывает unresolved-view reject и ноль DB reads.
- `scripts/isolated-test-host.mjs` получает отдельную cache install для запрошенной версии, меняет `applicationName`, `dataFolderName`, `win32MutexName` и `win32AppUserModelId` на version-specific test identity и восстанавливает исходный `product.json` в `finally` обоих runners.
- Release запускает hosts последовательно, поэтому одинаковый suffix для одной версии не создаёт collision внутри нормативного release runner. Поддержка конкурентных независимых запусков одной версии не является заявленным gate.
- Фактические development runs завершились `exit 0`: VS Code `1.105.1` и Current Stable `1.138.0`. Предыдущий Current timeout в этом прогоне не повторился.

## Clean/repro и verifier

- `clean` удаляет и `build/`, и `build-tests/`; оба release-цикла вызывают его до полного `npm test`, поэтому stale compiled tests не участвуют.
- Каждый `package` заново очищает production `build/`, собирает четыре outputs и выполняет exact verifier.
- Два package SHA-256 сравниваются до дальнейших smoke tests.
- `npm test` внутри каждого цикла включает minimum host; Current запускается отдельно после hash equality.
- Exact verifier фиксирует `0.2.0`, `^1.105.1`, `>=22.19.0 <25`, identity, target, view/commands/activation, exact entries и hashes четырёх outputs.
- Negative harness теперь содержит extra, missing, stale browser bundle и mutated Node engine cases.
- Низкоуровневый `package:repro` по-прежнему только дважды упаковывает, но нормативный `npm run release` больше от него не зависит и сам реализует требуемые полные независимые циклы.

## Выполненные проверки

| Команда | Результат |
| --- | --- |
| `node --check scripts/release.mjs` | Успешно |
| `node --check scripts/isolated-test-host.mjs` | Успешно |
| `node --check scripts/run-extension-tests.mjs` | Успешно |
| `node --check scripts/run-installed-extension-tests.mjs` | Успешно |
| `NODE_TLS_REJECT_UNAUTHORIZED=1 npm test` | Успешно |
| Unit suite | `60/60` успешно |
| Component suite | `29/29` успешно |
| `test:integration:min` внутри `npm test` | VS Code `1.105.1`, exit `0` |
| `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:integration:current` | VS Code `1.138.0`, exit `0` |
| `verify:webview-bundle` в обоих integration runs | Успешно, `32044` bytes |
| `git diff --check` после тестов | Успешно для target tree; параллельный untracked report не относится к commit |

Не запускались: `npm run package`, `npm run package:repro`, `npm run test:verify-vsix-negative`, `npm run verify:vsix`, installed min/current и полный `npm run release`. Эти команды требуют отсутствующий Step 2 VSIX либо создают его, что запрещено задачей.

## Итог

Открыто: `Blocker=1`, `High=0`, `Medium=1`, `Low=0`.

- HIGH unresolved-view/browser-ready source gate закрыт.
- MEDIUM clean/repro release orchestration закрыт на уровне исполнимого source; фактические hashes pending вместе с artifact Blocker.
- MEDIUM exact `engines.node` и negative mutation закрыт на уровне verifier source; фактический reject pending вместе с artifact Blocker.
- MEDIUM full traceability остаётся открытым из-за несуществующих manual ID, неполных сопоставлений и неточного automated claim.
- BLOCKER отсутствующего VSIX остаётся ожидаемым release gate и не может быть закрыт этим source-only re-review.

Новых findings: `Blocker=0`, `High=0`, `Medium=0`, `Low=0`. Обнаруженные traceability-дефекты являются дополнительным evidence для уже открытого MEDIUM-03. Targeted testability review exit не достигнут до исправления traceability; после него source-level exit может быть `Blocker=1 / High=0 / Medium=0 / Low=0`, где единственный Blocker закрывается только фактическим clean package/repro/exact/install gate.
