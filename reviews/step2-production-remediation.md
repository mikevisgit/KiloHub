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
