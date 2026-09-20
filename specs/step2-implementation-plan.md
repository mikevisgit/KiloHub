# План реализации Step 2

## 1. Цель и статус

Цель Step 2 — выпустить устанавливаемый Windows VSIX `0.2.0`, который заменяет нативный `TreeView` Step 1 выбранным `WebviewView` «Монограммы», не меняет источник и состав данных Kilo и проходит автоматическую, независимую, пакетную и пользовательскую приёмку на одном release candidate.

Статус на момент создания плана:

- [x] Требования, дизайн, размерная спецификация, тестовая матрица и ручной чек-лист подготовлены и прочитаны.
- [x] Текущий production-код Step 1, unit/integration tests, build/package/install scripts и ограничения release-процесса изучены.
- [ ] Baseline Step 1 зафиксирован повторным чистым прогоном.
- [ ] Production-реализация Step 2 начата.
- [ ] Production-тесты, независимые ревью, VSIX `0.2.0`, установка и ручная приёмка выполнены.

Отметки `[x]` выше означают только готовность входных требований и дизайна. Offline-макет и его проверки не являются доказательством production Webview, установленного VSIX или живого browser-rendering.

## 2. Нормативные источники и приоритет

Применять требования в следующем порядке:

1. `req/step2/02-уточнение-ТЗ.md`.
2. `req/step2/ТЗ реализации дизайна VSIX.md`.
3. `req/step2/design-size-spec.md`.
4. `req/step1/01-requirements.md` для данных, read-only поведения и команд, явно не изменённых Step 2.

Процесс и evidence задают также:

- `req/step2/README.md` и `req/step2/START_HERE.md`;
- `req/step2/03-test-matrix.md`;
- `req/step2/04-manual-acceptance-checklist.md`;
- `agents.md`, `specs/step1-implementation-plan.md` и `handoff.md`.

`req/step2/old_donotuse/` не является источником требований или runtime-зависимостью. Файлы `req/step2/variants/` являются behavioral/visual reference и offline-проверками, но не копируются в production и не входят в VSIX.

## 3. Неизменяемые инварианты

- Kilo SQLite открывается только read-only и `query_only`, без миграций, создания таблиц, записи pragma, собственного реестра или постоянного кэша данных.
- WAL-aware чтение, bounded busy/worker timeout, schema guard и закрытие connection Step 1 сохраняются.
- Запрашиваются только metadata обычных root sessions: `id`, `title`, `directory`, `parent_id`, `time_created`, `time_updated`, `time_archived`; `parent_id IS NULL`, `time_archived IS NULL`.
- Тела сообщений, таблица сообщений, содержимое файлов проектов и иные пользовательские данные не читаются.
- Допустимы только локальные абсолютные Windows folders. UNC, Remote, WSL, Dev Container, namespace/device paths, `.code-workspace`, относительные и неоднозначные пути исключаются.
- Missing folder остаётся в истории, пока существует подходящая session; Webview не получает прямого доступа к БД или файловой системе.
- Webview получает только минимальный DTO. В сообщении Webview → host нет path, URI или command ID; действие задаётся типом, `folderId` и revision.
- Единственное разрешённое постоянное состояние browser-части — техническое UI-состояние через Webview state: раскрытый ID, scroll/focus hints и версия формата. Snapshot папок остаётся в памяти host и восстанавливается из Kilo.
- Нет сети, telemetry, LLM, поиска, избранного, copy path, ручного реестра/цветов, открытия конкретного диалога, auto watcher, собственного storage и миграции Kilo.
- Все пользовательские metadata создаются через DOM API и `textContent`; raw HTML, `eval` и динамическое исполнение пользовательских строк запрещены.
- Ошибка refresh сохраняет последний корректный in-memory snapshot. Workspace/current пересчитывается без чтения БД.
- Тестовые fixtures, demo themes, требования, review-отчёты, source maps, БД и sidecar-файлы не входят в production bundle/VSIX.

## 4. Целевая структура изменений

Минимальная начальная раскладка production-кода:

| Путь | Назначение |
| --- | --- |
| `src/kiloDataSource.ts`, `src/kiloDataWorker.ts` | Сохранённый metadata-only read-only adapter и worker. |
| `src/projection.ts`, `src/types.ts`, `src/windowsPathSafety.ts` | Сохранённая domain projection и Windows path safety; изменять только при доказанной необходимости Step 2. |
| `src/presentation.ts` | Чистые presenter/date/monogram/color функции и минимальный DTO без VS Code/DOM API. |
| `src/currentFolder.ts` | Чистое сопоставление workspace descriptor со snapshot и тонкий host resolver. |
| `src/webviewProtocol.ts` | Версионированные DTO/envelopes, strict runtime validators и лимиты входных данных. |
| `src/webviewState.ts` | Чистая state machine initial/loading/ready/refreshing/error/stale и revision. |
| `src/kiloHubWebviewProvider.ts` | `WebviewViewProvider`, lifecycle, refresh/current orchestration, snapshot ownership и postMessage. |
| `src/commands.ts` | Проверенный executor трёх действий и регистрация существующих command IDs без доверия к browser payload. |
| `src/webview/main.ts` | Browser entry: проверка host messages, DOM, chunked render, UI-state restore и events. |
| `src/webview/styles.css` | Production CSS монограмм на `--vscode-*`, forced colors, размеры, focus и motion. |
| `src/extension.ts` | Минимальная композиция adapter, provider, commands, Output и subscriptions. |

`src/folderTreeProvider.ts` удаляется только после прохождения Webview contract/integration tests. Browser-код сначала держать в одном entry-файле; выделять accordion/tooltip/theme modules только если это упрощает независимые тесты и не создаёт дублирование.

Планируемые test/build/evidence области:

| Путь | Назначение |
| --- | --- |
| `tests/unit/` | Чистая логика, state machine, protocol, authorization и сохранённые backend regressions. |
| `tests/component/` | Browser DOM, accessibility, accordion, tooltip, theme и hostile strings в изолированной DOM-среде. |
| `tests/integration/` | Manifest, activation, provider/commands, worker, packaged contract и installed-host smoke. |
| `tests/fixtures/` | Только обезличенные SQLite/DOM/workspace fixtures. |
| `scripts/build.mjs` | Отдельные Node host/worker bundles и CSP-compatible browser JS/CSS без source maps. |
| `scripts/package.mjs` | Чистая воспроизводимая упаковка `0.2.0`. |
| `scripts/verify-vsix.ps1` | Exact allow-list, manifest и hash/provenance verifier. |
| `reviews/` | Независимые отчёты и targeted re-review каждого исправления. |
| `docs/` и `handoff.md` | Команды, результаты, release evidence, ограничения и manual result. |
| `build/` | Только сгенерированные host/browser outputs и временные результаты. |
| `dist/` | Только итоговый `kilo-hub-0.2.0-win32-x64.vsix`. |

Для component tests допускается одна точно закреплённая dev-only DOM-зависимость. Она выбирается коротким spike на Node 22, записывается в lockfile, проходит license/audit review и не попадает в VSIX. Geometry, layout и screen reader нельзя объявлять пройденными только по эмуляции DOM.

## 5. Milestones и gates

### M0. Подготовка требований и дизайна

Зависимости: нет.

- [x] Зафиксирован один дизайн «Монограммы» без переключателя вариантов.
- [x] Закрыты вопросы header, доступного tooltip, theme scope, review loop, performance scope и ручной приёмки.
- [x] Сформированы нормативные `03-test-matrix.md` и `04-manual-acceptance-checklist.md`.
- [x] Подтверждено, что Webview implementation/VSIX ещё отсутствуют.

Gate M0: выполнен только как requirements/design preparation.

### M1. Baseline freeze Step 1

Зависимости: M0.

- [ ] Зафиксировать полный исходный commit и убедиться, что нормативные изменения Step 2 и этот план находятся в истории Git отдельно от production-кода.
- [ ] Проверить `git status`, `git diff`, `git diff --check` и `git log --oneline -10`; не затрагивать параллельные изменения.
- [ ] Выполнить `npm ci`, `npm audit --audit-level=high`, `npm test`, `npm run package`, `npm run test:installed` на baseline `0.1.0`.
- [ ] Повторно доказать неизменность fixture DB и Step 1 read-only/WAL/busy/path-safety regressions.
- [ ] Запустить шесть команд из `req/step2/START_HERE.md`; после генерации убедиться, что reference-макет воспроизводим и не оставляет неожиданный diff.
- [ ] Записать версии Node/npm/VS Code, commit, команды и baseline SHA-256 в `handoff.md`/`docs/`, не выдавая offline reference за production evidence.

Gate M1: baseline полностью зелёный, рабочее дерево чистое, известен exact commit Step 1 и нет необъяснённых изменений. Любое падение сначала устраняется или записывается как blocker; Webview-код до этого не начинается.

### M2. Чистая presentation logic

Зависимости: M1.

- [ ] Ввести минимальный browser DTO: folder ID, безопасный display name/full path, `available`, `current`, достоверный activity timestamp, monogram, color slot и максимум три display-conversation title. Не передавать raw session row, parent/archive/create metadata, executable URI или command.
- [ ] Presenter не мутирует domain snapshot, сохраняет полный список folders, выбирает до трёх диалогов только для отображения и выдаёт детерминированный результат при перестановке входа.
- [ ] Определять последнюю достоверную активность из conversations: invalid/missing/future timestamps становятся unknown и не вытесняют реальную прошлую активность.
- [ ] Реализовать current resolver для ровно одного local `file` workspace без `workspaceFile`; empty/multi-root/remote/workspace-file/unsafe realpath дают `null` и диагностическую причину.
- [ ] Сортировать current first; затем known activity descending; unknown по имени; tie-break по имени и нормализованному path/ID. Диалоги сортировать по точному времени, title и ID до ограничения трёх строк.
- [ ] Реализовать относительные даты по локальным календарным дням, включая все границы `0/1/2/6/7/13/14/20/21/29/30/59/60/364/365`, future-today, DST, leap day и русские склонения. Clock/time zone должны быть инъецируемыми в тесте.
- [ ] Реализовать инициалы через NFC, Unicode words и `Intl.Segmenter('ru', { granularity: 'grapheme' })`, включая fallback basename и `?`.
- [ ] Реализовать нормализацию color key, FNV-1a по UTF-16, `% 16`, точный `slotOrder` и чистый расчёт adaptive palette/black-white initials без зависимости от current/missing/order/theme reload.
- [ ] Сверить golden cases с `req/step2/variants/folder-colors.cjs`, не импортируя demo-файл в production.

Gate M2: parameterized/property unit tests покрывают PRES-02..05, MONO-01, COLOR-01..02; existing projection/data tests остаются зелёными. Никакого VS Code, DOM, I/O или timer side effect в чистых функциях.

### M3. Host Webview controller, state и revision

Зависимости: M2.

- [ ] Заменить регистрацию `TreeView` на один `registerWebviewViewProvider` с прежним view ID и нативным именем `Kilo Hub`.
- [ ] Создать state machine initial/loading/ready/refreshing/initial-error/refresh-error-stale с точными русскими текстами и сохранением предыдущего snapshot при refresh error.
- [ ] Host владеет полным последним корректным domain snapshot; Webview state не хранит snapshot или Kilo metadata.
- [ ] Каждая host-публикация использует protocol version и строго монотонную revision. Browser принимает только новую revision и игнорирует duplicate/out-of-order сообщения.
- [ ] Browser при создании отправляет разрешённый initial `refresh` как синхронизацию. Первый такой запрос возвращает retained snapshot без нового DB read, если он уже есть; при отсутствии snapshot запускает единственное первое чтение. Последующие user refresh выполняют реальное чтение.
- [ ] Повторные refresh во время чтения объединяются; success атомарно заменяет snapshot, error сохраняет старый; stale/removed folders исчезают только после success.
- [ ] Workspace change, successful refresh и action authorization пересчитывают current. Workspace change не читает SQLite.
- [ ] Local-day rollover и возврат видимости/focus обновляют date labels из snapshot без чтения SQLite.
- [ ] Strict runtime validation действует в обе стороны: plain object, exact keys, version/type, finite revision, bounded ID/string/array sizes, отсутствие лишних полей и prototype-shaped payload.
- [ ] Dispose/revive очищает listeners/timers, сохраняет только допустимый UI state и не допускает postMessage в устаревший view.

Gate M3: unit/controller tests с deferred promises проходят для initial/load/refresh/error/race/revision/dispose/revive/workspace change; один refresh соответствует максимум одному worker read.

### M4. Browser bundle, DOM и утверждённый UI

Зависимости: зафиксированные DTO/protocol из M2–M3.

- [ ] Собирать browser entry отдельно с `platform: browser`; bundle не импортирует `vscode`, Node built-ins, adapter, filesystem или demo assets.
- [ ] DOM начинается со строки `Мои папки с Kilo`; DOM-дубликата `Kilo Hub` и текста `Kilo Folders` нет.
- [ ] Рендерить loading/empty/ready/refreshing/error/stale, полный список folders и таблицу действий current/missing с точными текстами.
- [ ] Создавать пользовательский текст только через `textContent`; conversations пассивны, имеют видимый ellipsis и полный visually-hidden текст ровно один раз в accessibility tree.
- [ ] Рендер большого snapshot выполнять порциями с event-loop yield; индикатор busy появляется до тяжёлой обработки.
- [ ] Реализовать accordion «не более одного», повторное закрытие, последнее намерение, Enter/Space, `aria-expanded`/`aria-controls`, `inert`/`aria-hidden`, безопасный focus и 320 ms cubic easing.
- [ ] Реализовать scroll compensation для середины/начала/конца списка; reduced motion через VS Code class и media query даёт duration 0, но сохраняет итог/focus/scroll invariants.
- [ ] Реализовать единый доступный tooltip-controller по УТЗ-05: hover и keyboard focus, popup hover, grace 120 ms, Escape/dismiss reset, стабильные ID/`aria-describedby`, один popup одновременно и отсутствие отдельных date/missing owners.
- [ ] Позиционировать tooltip внутри viewport с отступом 8 CSSpx, переносом вверх, `330/360px` limits, scroll/resize/zoom reposition и доступной прокруткой длинного текста.
- [ ] Восстанавливать expanded ID, scroll и разумный focus только если folder ещё существует; удалённый target сбрасывать на видимый безопасный элемент.
- [ ] Перенести нормативные размеры/геометрию из `design-size-spec.md` в production CSS без demo shell, `demo-themes.css`, font shrink и inverse zoom.
- [ ] Использовать semantic `--vscode-*`, forced colors и вычисляемые monogram colors; theme mutation не меняет path→slot и не требует reload.

Gate M4: component suite проходит DOM/keyboard/focus/tooltip/accordion/theme/hostile-string contracts; CSS/source contract проверен при B=13/16/20 и 260/320/400. Фактическая геометрия, zoom, contrast и screen reader остаются pending до installed manual gate.

### M5. Authorization, commands, security и CSP

Зависимости: M3 и M4.

- [ ] Разрешить Webview → host только `refresh`, `openHere`, `openNewWindow`, `revealInExplorer`; action содержит folder ID и revision, но не path/URI/command.
- [ ] Перед каждым действием проверить protocol, совпадение revision/current snapshot, существование ID, таблицу current/missing, повторный current resolver и свежий `stat`/`realpath` path-safety check.
- [ ] Получать URI только из host snapshot. Forged/stale/oversize/extra-field/invalid-state messages не вызывают API, DB read или произвольную команду.
- [ ] Сохранить exact adapters: `vscode.openFolder` + `forceReuseWindow`, `vscode.openFolder` + `forceNewWindow`, проверенный Explorer adapter.
- [ ] Существующие command IDs либо проходят тот же authorizer с host-only reference, либо отклоняют внешний непроверенный аргумент; скрытие кнопки никогда не является authorization.
- [ ] Генерировать HTML с криптографическим nonce, локальными `asWebviewUri`, минимальным `localResourceRoots` и CSP `default-src 'none'` с только реально нужными directives.
- [ ] Не использовать inline script, `eval`, network/connect sources или внешние ресурсы. Способ динамического позиционирования tooltip должен пройти CSP test без скрытого ослабления политики.
- [ ] Проверить XSS payload, quotes, bidi/control, `javascript:`, malformed objects и oversized payload; ошибки для UI санитизируются, technical detail остаётся в Output `Kilo Hub`.

Gate M5: negative authorization/fuzz/XSS/CSP tests доказывают отсутствие side effects; exact HTML/CSP parser и bundle scan не находят запрещённых sources/API. Все три реальные команды пока считаются автоматизированно проверенными только на уровне exact API arguments и authorization, не GUI-результата.

### M6. Полный automated gate

Зависимости: M2–M5.

- [ ] Обновить `package.json`: version `0.2.0`, view `type: "webview"`, name `Kilo Hub`, отсутствие старого view-title refresh, только заявленные команды и прежний `extensionKind: ["ui"]`.
- [ ] Расширить TypeScript/build/lint/test scripts для browser и component tests, не ослабляя strict TypeScript или ESLint.
- [ ] Сохранить все Step 1 adapter/projection/path/read-only/WAL/busy/event-loop tests как regressions.
- [ ] Покрыть все строки `req/step2/03-test-matrix.md` ссылкой на automated test либо явный manual ID; отсутствие публичного API не заменять фиктивным unit test.
- [ ] Добавить 1000-session regression: все folders/sort/limit/actions/revision верны, worker и browser render дают event-loop heartbeat, parallel reads отсутствуют. Время записать диагностически без нового pass/fail SLA.
- [ ] Проверить exact manifest/activation/command surface и отсутствие TreeView contract.
- [ ] Проверить development Extension Host на VS Code `1.105.1`: activation, Webview provider, initial synchronization, worker refresh и неизменность fixture DB.
- [ ] Выполнить `npm audit --audit-level=high`, `npm run check-types`, `npm run lint`, unit, component, integration и общий `npm test`.

Gate M6: полный suite зелёный из clean checkout; traceability не содержит строк без automated/manual disposition; production bundles не содержат fixtures/demo/requirements/source maps/network code.

### M7. Повторные независимые review loops

Зависимости: M6; package review завершается вместе с M8.

- [ ] Независимо проверить трассировку требований и отсутствие scope creep.
- [ ] Независимо проверить read-only/metadata-only backend и security residuals Step 1.
- [ ] Независимо проверить presenter, state machine, revision и refresh protocol.
- [ ] Независимо проверить runtime validation, authorization, XSS, CSP, local assets и отсутствие сети.
- [ ] Независимо проверить accessibility, keyboard, focus, tooltip и screen-reader semantics.
- [ ] Независимо проверить tests, negative cases, concurrency и 1000-session invariants.
- [ ] Независимо проверить themes/contrast/color/size/motion/scroll contracts.
- [ ] После M8 независимо проверить exact package contents, provenance и installed smoke.

Каждый отчёт в `reviews/` содержит source commit, при наличии VSIX path/SHA-256, severity, evidence и disposition. После каждого исправления выполняются targeted test и targeted re-review затронутой области плюс зависимые regressions. Исправление создаёт новый source commit; если изменился production/package input, прежний VSIX и зависящее от него evidence аннулируются, M8 повторяется.

Gate M7: цикл повторяется до `Blocker=0`, `High=0`; каждый `Medium`/`Low` имеет disposition `исправлен`, `не применим` или `принятое ограничение` с обоснованием и evidence. Непроверенное не считается ограничением или прохождением.

### M8. Clean package `0.2.0`, exact verifier, reproducibility и install

Зависимости: зелёный M6 и текущий review candidate M7.

- [ ] До release commit подготовить русские release notes и manifest `0.2.0`; выполнить status/diff/log, закоммитить только целевые проверенные файлы.
- [ ] Обновить build до exact outputs: `build/extension.js`, `build/kiloDataWorker.js`, production browser JS и CSS. Source maps и demo assets не генерировать для package.
- [ ] Обновить положительный `files` allow-list и exact verifier для полного списка entries, identity/version/target/engine, Webview contribution, CSP assets и SHA-256 каждого build output.
- [ ] Добавить negative verifier tests: лишний, отсутствующий и stale/mutated asset должны отклоняться.
- [ ] Из чистого checkout выполнить два независимых цикла `npm ci` → `npm run clean` → full test → `npm run package`; оба раза получить байт-в-байт одинаковый `dist/kilo-hub-0.2.0-win32-x64.vsix`.
- [ ] Exact archive не содержит `tests/`, fixtures, `req/`, `reviews/`, `old_donotuse/`, demo themes/HTML/JS, source maps, DB/WAL/SHM, `node_modules/` и лишние исходники.
- [ ] Запустить exact verifier до любой установки и записать path, bytes и SHA-256.
- [ ] Установить именно этот SHA-256 с `--force` в пустые изолированные `--user-data-dir`/`--extensions-dir` на VS Code `1.105.1` и актуальной release-версии.
- [ ] Installed-host smoke подтверждает identity `local.kilo-hub@0.2.0`, activation, browser asset load/initial protocol synchronization и packaged-worker refresh на обезличенной fixture.
- [ ] Провести package review M7 на том же commit/hash; любое package finding запускает fix → re-test → new package → exact verify → reinstall → re-review.

Gate M8: существует один текущий reproducible exact-verified устанавливаемый VSIX с записанными full source commit и SHA-256; все автоматические/review evidence относятся к нему.

### M9. Ручной пользовательский checklist и финальное evidence

Зависимости: финальные M7 и M8.

- [ ] Создать в `docs/` результат прогона по `req/step2/04-manual-acceptance-checklist.md`, не изменяя нормативный шаблон; заполнить паспорт commit/hash/VS Code/Kilo/Windows/scaling/themes/NVDA/fixture.
- [ ] Выполнить установленный VSIX, а не local HTML или Extension Development Host.
- [ ] Проверить 260/320/400 CSSpx, zoom 100/200%, отсутствие горизонтального scroll и ровно две верхние строки.
- [ ] Проверить четыре точные встроенные темы, live theme change, forced colors и два representative custom themes как best effort; приложить screenshots/contrast evidence.
- [ ] Проверить keyboard-only, NVDA semantics, focus, tooltip hover/focus/popup/Escape/viewport, duplicate names и точные объявления.
- [ ] Проверить accordion, быстрые нажатия, 320 ms, reduced motion, scroll compensation, длинный список и восстановление focus/expanded/scroll.
- [ ] Проверить loading/empty/refreshing/initial error/refresh error/recovery/current/missing/date/sort/three-conversation states.
- [ ] Выполнить три реальные folder actions только на disposable available non-current folder, только Explorer на current и подтвердить отсутствие actions у missing.
- [ ] Выполнить 1000-session observation без превращения субъективного результата в числовой SLA.
- [ ] Получить и записать пользовательский verdict по pixel-level и субъективному визуальному качеству. До этого пункта визуальная приёмка остаётся `Не проверено`.
- [ ] Обновить `handoff.md`: source commit, clean status, exact VSIX path/hash/size, версии, все команды, review exit, manual results, известные ограничения и остаточные риски.
- [ ] Выполнить финальные `git status`, `git diff`, `git diff --check` и сверку всех ссылок evidence на один commit/hash.

Gate M9: все обязательные manual cases имеют evidence и итог, пользовательская визуальная приёмка записана, а любое найденное несоответствие возвращает работу в M6–M8 и аннулирует зависящие результаты старого VSIX.

## 6. Граф зависимостей

Основной путь: `M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 ↔ M8 → M9`.

Допустимая параллельность после фиксации DTO/protocol:

- M4 browser DOM/CSS может развиваться параллельно с host-частью M3 только против замороженных contract tests.
- Security/CSP review начинается во время M3–M5, но gate M5 закрывается только на собранном browser bundle.
- Unit/component tests создаются вместе с каждым milestone; M6 — общий повторный gate, а не отложенное написание тестов.
- Package review требует реального VSIX из M8; остальные review domains могут начать цикл на зелёном source candidate M6.

Любое изменение protocol/DTO после M3 требует повторить M3–M6. Любое изменение browser assets/CSP после M4 требует повторить component/security/package/manual UI gates. Любое изменение adapter/projection/path safety требует полного read-only/WAL/security regression.

## 7. План коммитов будущей реализации

Текущая задача планирования коммитов не создаёт. В реализации использовать небольшие проверенные смысловые коммиты:

1. `docs: add Step 2 implementation plan`
2. `test: freeze Step 1 baseline for Step 2`
3. `feat: add Step 2 presentation model`
4. `feat: add secure Kilo Hub webview host`
5. `feat: add accessible monogram webview`
6. `test: cover Step 2 acceptance contracts`
7. `fix: address Step 2 review findings` — отдельный коммит на логически связанную серию исправлений, повторяется по циклу.
8. `release: prepare Kilo Hub 0.2.0`
9. `docs: record Step 2 verification and release`

Перед каждым коммитом выполнять `git status`, `git diff`, `git diff --check`, `git log --oneline -10`, запускать относящийся gate и добавлять в индекс только целевые файлы. Не смешивать generated `build/`, review fixes, release metadata и чужие изменения. Итоговый VSIX добавлять в историю только если это соответствует действующей политике репозитория; в любом случае его exact path/hash обязаны быть записаны.

## 8. Правило завершения Step 2

Step 2 завершён только при одновременном выполнении всех условий:

- M1–M9 отмечены `[x]` после фактической проверки, а не по наличию кода или макета.
- Все требования `req/step2/03-test-matrix.md` имеют automated/manual evidence и итог на одном release candidate.
- Read-only/metadata-only инварианты доказаны повторно; Kilo DB/WAL и logical sessions не изменены в заявленных границах SQLite, чтение сообщений отсутствует.
- TypeScript, ESLint, unit, component, extension, installed и package проверки зелёные.
- Независимый review exit достигнут: `Blocker=0`, `High=0`, каждый `Medium`/`Low` имеет доказанный disposition, targeted re-review завершён.
- `dist/kilo-hub-0.2.0-win32-x64.vsix` воспроизводим, exact-verified, установлен в изолированные профили и связан с одним полным source commit и SHA-256.
- Все обязательные строки ручного checklist завершены; `Блокировано` или пустой результат не считаются прохождением без отдельного допустимого и доказанного disposition.
- Пользователь записал итог финальной субъективной/pixel-level визуальной проверки установленного окна.
- `handoff.md` содержит точный артефакт, checksum, размер, версии, команды, review/manual evidence и известные ограничения.

Если изменился source commit, browser asset или VSIX SHA-256, все зависящие review/package/install/manual evidence считаются устаревшими и соответствующие gates выполняются повторно.
