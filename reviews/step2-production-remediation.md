# Step 2 — remediation production review

## Исходная точка

Review target: commit `b324982cedc2527826ffc2d74e54dff984abfeac` (`feat: add Kilo Hub Step 2 webview`).

Первый production review cycle:

| Domain | Blocker | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| Requirements | 0 | 2 | 7 | 1 |
| Security/read-only | 0 | 0 | 4 | 3 |
| Accessibility/interaction | 0 | 3 | 5 | 2 |
| Tests/package | 1 | 5 | 4 | 0 |

Исходные отчёты:

- `reviews/step2-production-requirements-review.md`;
- `reviews/step2-production-security-review.md`;
- `reviews/step2-production-accessibility-review.md`;
- `reviews/step2-production-testability-review.md`.

## Сводные исправления

| ID | Объединённые findings | Решение | Статус/evidence |
| --- | --- | --- | --- |
| R-01 | Синхронный большой DOM render; нет browser heartbeat | Cancelable chunked render, busy до chunks, newer revision cancels stale render, 1000-folder sentinel component test | Fixed: component 29/29 |
| R-02 | Host использует опубликованный current и допускает TOCTOU до side effect | Fresh workspace/current resolver и revision перед действием и final guard после `stat/realpath` перед VS Code API | Fixed: integration workspace/revision/final-guard races |
| R-03 | Path/reparse/network residual и раскрытие path пользователю/log | Открывать canonical resolved local target; reject resolved UNC; generic toast/redacted Output; initial Windows provider lookup остаётся принятым platform limitation | Fixed/accepted limitation with unit and integration evidence |
| R-04 | Adapter/DTO/resource limits несовместимы; `.all()` материализует unlimited rows | Общие лимиты id512/title+path4096, iterator, 10000 rows и общий ~4 MiB char budget; protocol global budget; boundary tests | Fixed: unit 57/57 |
| R-05 | Webview lifecycle допускает late postMessage/action после dispose/replacement | View generation/deferred ready/dispose guard; tests dispose/revive/late promises | Fixed: integration lifecycle cases |
| R-06 | Installed test не доказывает browser bundle/ready | При resolved view `refresh()` ожидает bounded real `ready` handshake; installed open-view+refresh падает при blank/CSP/missing bundle | Fixed in source/tests; final installed evidence pending package |
| R-07 | CSP/browser build tests слишком поверхностны | Exact CSP/nonce/local roots tests; forbidden bundle scan; browser assets isolated; no network/Node/eval/source maps | Fixed: integration + bundle scan |
| R-08 | Persistent Webview metadata cache | Удалён host snapshot из `setState`; сохраняются только scroll и opaque expansion hash; DTO всегда приходит от host | Fixed до review remediation commit; component test не допускает path/title/DTO в persisted state |
| R-09 | Approved composition/action icons/info/header border | Удалить action icons; вернуть approved spacing, `ⓘ`, bottom border/padding; source/CSS contract tests | Fixed: CSS/source contract tests |
| R-10 | Accessible name дублирует path; outer live region; wrong heading | Path только stable description; folder name/status/date в name; убрать outer live; `Последние диалоги` = h2 | Fixed: component semantics tests |
| R-11 | Escape не глобален; stale popup; theme не reposition | ownerDocument Escape, stale hover reset, reposition on theme, targeted cross-modality regressions | Fixed: tooltip regressions |
| R-12 | Focus теряется при удалении folder/action; outline clipping | same-folder/nearest/refresh fallback; safe overflow/focus CSS; component tests | Fixed: focus component tests |
| R-13 | CSS/date/theme evidence неполно | Source CSS contract, browser date boundaries/DST, theme mutation/reposition, forced-colors traceability; реальная геометрия остаётся manual | Fixed automated scope; installed manual pending |
| R-14 | Protocol docs исключали `ready` | Канон/matrix/plan включают metadata-free versioned `ready` handshake | Fixed |
| R-15 | Node floor и minimum/current runner | Runtime engine `>=22.19`; build pin `.nvmrc=22.20`; parameterized minimum/current dev+installed runners; isolated test-host mutex identity | Fixed: VS Code 1.105.1 and 1.138.0 development tests pass |
| R-16 | Verifier не фиксирует 0.2.0 и не имеет negative/repro gates | Fixed expected version, extra/missing/stale negative harness, `package:repro`, exact four bundle hashes | Implemented; execution pending clean package |
| R-17 | Финальный VSIX 0.2.0 отсутствует | Clean commit, secure `npm ci`, full gates, two reproducible packages, exact verifier, minimum/current installed tests | Pending после code review exit |

## Review exit

Remediation не завершён, пока:

1. automated gate не пройдёт единым запуском;
2. каждый исходный finding не получит `fixed`, `not applicable` или `accepted limitation` с evidence;
3. targeted re-review четырёх domains не подтвердит отсутствие открытых findings;
4. full review чистого release-candidate commit не даст `Blocker=0`, `High=0`, а все Medium/Low будут закрыты;
5. exact VSIX hash не пройдёт package/repro/install gate.

## Финальный package/release exit

R-17 закрыт для source commit `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9` и SHA-256 `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`:

- два независимых clean/full/package cycles дали одинаковые `31547` bytes;
- exact verifier проверил 10 entries, identity/version/target/engines/view/commands и hashes четырёх bundles;
- negative verifier отклонил extra, missing, stale и wrong-engine packages;
- development и installed Extension Host tests прошли на VS Code `1.105.1` и `1.138.0`;
- основной профиль содержит `local.kilo-hub@0.2.0`;
- финальный package review: `Blocker 0 / High 0 / Medium 0 / Low 0`, `PACKAGE/RELEASE APPROVED`.

Все source/package review findings закрыты. Остаётся только пользовательский manual visual/NVDA/actions verdict, который не подменяется автоматическими evidence.

## Targeted re-review и второй набор исправлений

Targeted re-review commit `c5cd72b` подтвердил закрытие всех исходных Requirements и Accessibility findings, но нашёл один общий Low в документации (`History h3` вместо production `h2`); размерная спецификация исправлена.

Security re-review оставил `MEDIUM-04` и `LOW-02`. Исправления второго набора:

- metadata SQL больше не создаёт полный `ORDER BY` temporary B-tree: field bounds и `LIMIT 10001` применяются до Node materialization, сортировка выполняется bounded presenter;
- query-plan regression запрещает `TEMP B-TREE`; oversized rows считаются отдельно без передачи длинных полей в DTO;
- worker timeout ожидает `worker.terminate()`;
- глобальный semaphore удерживает максимум 16 фактически незавершённых `realpath/stat` probes даже после Promise timeout;
- все host/adapter/command exception diagnostics проходят единую path/control/length sanitization и отдельные tests.

Testability re-review оставил browser-ready High, три Medium и ожидаемый package Blocker. Исправления:

- public refresh fail-closed открывает view, ждёт `resolveWebviewView` и browser `ready`; без view/bundle/CSP handshake SQLite read не начинается;
- minimum/current test hosts получают отдельную временную Windows app/mutex identity, исходный `product.json` восстанавливается в `finally`;
- release runner выполняет два независимых `npm ci → audit → clean → full test → package` cycles и сравнивает SHA-256;
- verifier фиксирует `engines.node`, negative harness дополнен mutated manifest;
- каждая строка Step 2 matrix связана с точным test file/name и manual ID; checklist дополнен security/scope cases.

Automated evidence после второго набора: `60/60` unit, `29/29` component, full `npm test`, VS Code `1.105.1` и `1.138.0` exit `0`, audit `0 vulnerabilities`, browser scan pass. Source targeted re-review повторяется на новом commit; package Blocker закрывается только фактическим release gate.

### Третье source-закрытие после targeted re-review

Второй targeted pass подтвердил предыдущие fixes и выявил остаточные случаи внутри существующих findings. Они устранены:

- SQL bounds теперь включают `typeof/range` для обоих timestamps, поэтому BLOB/TEXT timestamp не materialize в Node; invalid-row warning probe ограничен `LIMIT 101`;
- поздний resolve/reject path probe освобождает semaphore через symmetric handled `then`, а deterministic test доказывает максимум 16 physical pending probes и отсутствие unhandled rejection;
- warning Output boundary применяет sanitizer к path-shaped session IDs;
- public Refresh fail-closed требует resolved view и browser `ready` до DB read;
- два full clean release cycles, exact Node engine mutation и requirement traceability формализованы executable scripts/matrix;
- production/size/reference/test matrix используют `History h2`; пассивные dialogue rows не получают Tab-stop, но сохраняют hover tooltip;
- traceability manual IDs сверены с реально объявленными checklist IDs, missing security/scope cases добавлены.

Automated evidence: `62/62` unit, `29/29` component, full `npm test`, все шесть design-reference verify, minimum VS Code `1.105.1` и Current `1.138.0` exit `0`. Source review exit повторно проверяется на следующем commit; package Blocker остаётся единственным ожидаемым gate.

## Visual hotfix `0.2.1`

Пользовательская проверка `0.2.0` выявила два blocking visual findings: browser presentation атрибута `hidden` перекрывался author CSS, а стандартный Webview `body` padding складывался с production gutter. В candidate `0.2.1` добавлен безусловный `[hidden]`, внешний padding сброшен, full-width/minmax constraints закреплены для panel/list/card/detail/actions, а рамка перенесена с оболочки `.hub` на `.folder`.

Независимое read-only review незакоммиченного candidate подтвердило `Blocker 0 / High 0 / Medium 0 / Low 0`. Проверены visibility, tooltip/sr-only, отсутствие ожидаемого horizontal overflow, сохранение `--hub-row-x`, focus/forced-colors и согласованность версии `0.2.1`. Full `npm test` после version bump прошёл: unit `62/62`, component `29/29`, bundle scan и Extension Host VS Code `1.105.1` exit `0`; ESLint, TypeScript и `git diff --check` проходят. Остаточные риски относятся к реальному Chromium layout на 260 px/200% zoom, Windows forced colors и пользовательской визуальной проверке установленного пакета.

Package/install evidence для `0.2.1` на момент source review отсутствует и выполняется после отдельного чистого hotfix commit. Evidence `0.2.0` на этот candidate не переносится.

## Tooltip hotfix `0.2.2`

Последующий source review `0.2.3`: findings отсутствуют. Проверены единственный owner inline `.folder-name`, `focusable:false`, ARIA description target на head и его cleanup, отсутствие остальных registrations, manifest/lock/verifier `0.2.3` и PNG. PNG совпадает с Kilo `7.7.5` logo-outline-black.png, SHA-256 `65F8A36A2C905AFC8AC063FC1CEADD1CEA396314310667B64D2E4A94D38EC87B`. Full `npm test`: `62/62` unit, `29/29` component, minimum Extension Host PASS. Exact package/install проверяются отдельно после source commit.

Финальный package review `0.2.3`: `0/0/0/0`, PASS. Размер `33782`, SHA-256 `8F73194023B4DA6CB1136BB42B5A9421017C3157F8627CCDF2467677D2F31C9B`. Подтверждены exact 11 entries, 4/4 bundle hashes, 2/2 иконки, manifest, единственный name owner и синхронный hide при `graceMs:0`, ARIA cleanup. Полный release и установка в основной профиль завершены.

Пользовательская проверка установленного `0.2.1` выявила несоответствие ожидаемому макету: tooltip заголовка истории и каждой строки диалога создавали лишний шум, а popup удерживался при наведении и перекрывал содержимое. Новое УТЗ-09 удаляет эти owners и возвращает геометрическое немедленное скрытие popup, сохраняя keyboard-focus и ARIA оставшихся интерактивных источников.

Production удаляет `tabindex`/tooltip registration заголовка истории и registrations названий диалогов. Tooltip popup получает `pointer-events:none`; capture `pointermove` документа проверяет фактический `getBoundingClientRect`, немедленно скрывает popup внутри и на границе и удерживает dismissal latch до реального завершения взаимодействия с owner. Targeted component regressions проходят `29/29`; полный release gate и независимое review выполняются на candidate `0.2.2`.

Первое независимое source review `0.2.2`: `Blocker 0 / High 1 / Medium 2 / Low 0`. Исправления:

- race реального порядка `pointerout → pointermove → pointerover` закрыт явным сбросом dismissal при первом новом interaction уже неактивного owner и точным regression test этого порядка;
- непрокручиваемое внутреннее обрезание устранено: popup имеет content height, `max-height:none` и `overflow:visible`; физическая граница Webview остаётся ограничением поверхности, полный текст доступен через ARIA;
- `design-size-spec.md`, package rows test matrix и manual passport обновлены с устаревших popup/`0.2.0` контрактов на УТЗ-09 и `0.2.2`.

Targeted проверки после исправлений: component `29/29`, TypeScript, ESLint и `git diff --check` — PASS. Требуется повторное независимое review и затем полный release gate.

Повторное review сначала выявило только два нормативных рассогласования geometry/package, после синхронизации канонического ТЗ, размерной спецификации, manual checklist и test matrix финальный результат: `Blocker 0 / High 0 / Medium 0 / Low 0`, verdict `SOURCE REVIEW APPROVED`. Все behavioral findings остаются закрыты; release gate выполняется на одном source commit `0.2.2`.

Финальный package review артефакта `dist/kilo-hub-0.2.2-win32-x64.vsix` на source commit `3de628bf5adf310cb0c41b3ba34a0acd08091f98`: `Blocker 0 / High 0 / Medium 0 / Low 0`, verdict `PACKAGE/RELEASE APPROVED`. Проверены exact 10 entries, manifest `local.kilo-hub@0.2.2`, target/engines, bundled tooltip behavior, отсутствие запрещённых файлов, bundle hashes, reproducible ZIP timestamp и installed evidence.
