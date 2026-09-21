# Финальное targeted security re-review Step 2

## Объект и scope

- Проверен commit `735f06afdd34baf89965308d91399beaf918b79b` (`fix: close Step 2 targeted review findings`); `HEAD` совпадал с target, tracked worktree до проверки был чистым.
- Базовый отчёт: `reviews/step2-production-security-rereview.md` на commit `c5cd72b`.
- Проверены только два ранее открытых finding: `MEDIUM-04` end-to-end resource bounds и `LOW-02` Output sanitization, а также связанные regressions.
- Ранее закрытые authorization/CSP/lifecycle/read-only findings заново не пересматривались; regression suites для них запущены.
- Package/VSIX evidence остаётся отдельным gate и в этот source review не входит.
- После завершения прогонов появились параллельные изменения `req/step2/variants/build-final.mjs`, `tests/component/webviewMain.test.ts` и других review-файлов. Они не относятся к commit `735f06a`, не использовались как evidence и не изменялись этим review.

## Disposition

### MEDIUM-04 — end-to-end resource bounds

**Статус: частично исправлен, остаётся открыт.**

Подтверждённые исправления:

- Production metadata query больше не содержит `ORDER BY`; `EXPLAIN QUERY PLAN` возвращает только `SCAN session`, без `TEMP B-TREE` (`src/kiloDataSource.ts:28-40`, `tests/unit/kiloDataSource.test.ts:263-275`).
- SQL применяет bounds к `id`, `title`, `directory` и возвращает не более `10001` подходящей строки. Node iterator сохраняет row limit `10000` и общий character budget около `4 MiB` (`src/kiloDataSource.ts:20-46,316-341`).
- Timeout worker теперь отклоняет read promise только после resolution/rejection `worker.terminate()` (`src/kiloDataSource.ts:414-428`). Это устраняет прежний fire-and-forget termination path.
- Глобальный semaphore не выдаёт более `16` permits одновременно и после timeout удерживает permit до settlement фактического `realpath/stat` operation (`src/windowsPathSafety.ts:4-21,43-79`). Тем самым прежнее неограниченное накопление незавершённых OS probes устранено.
- Browser chunked rendering, protocol budgets и worker read-only/WAL regressions остались зелёными.

Оставшиеся проблемы:

1. SQL bounds не охватывают все materialized columns. `time_created` и `time_updated` выбираются без `typeof(...)= 'integer'`/range guard. SQLite schema в fixture и production guard не является `STRICT`, поэтому declared `INTEGER NOT NULL` принимает большой TEXT/BLOB. Targeted in-memory reproduction вставил `1 MiB` BLOB в `time_created`; production `KILO_METADATA_QUERY` вернул его как `Uint8Array` размером `1048576` до `validateSessionRow()`. Такой payload не входит в character budget и уже материализован до JS rejection (`src/kiloDataSource.ts:28-40,251-269,318-331`). Значит, SQLite/Node oversized-cell materialization boundary остаётся незамкнутой. Нужен SQL type/range filter для всех selected non-null timestamp fields и regression с BLOB/TEXT timestamp.
2. После probe timeout используется `void operation.finally(releasePermit)` (`src/windowsPathSafety.ts:74-75`). Если `realpath` успел выполниться, а последующий `stat` поздно отклонится, `operation` rejected; `finally()` создаёт новый rejected promise без handler. Targeted Node semantics probe с `--unhandled-rejections=strict` завершился ошибкой `late stat`. Permit освобождается, но Extension Host получает unhandled rejection. Требуется settlement handler без отброшенного rejected promise, например symmetric `then(release, release)`, и deterministic deferred test.
3. Tests не проверяют ни глобальный предел фактически pending probes, ни поведение позднего resolve/reject после timeout, ни production worker timeout/ожидание termination. Текущий `tests/unit/windowsPathSafety.test.ts` использует только обычный существующий и отсутствующий temp path. Source-инвариант semaphore читаем, но его race/error lifecycle не закреплён.
4. `INVALID_METADATA_COUNT_QUERY` выполняет полный `count(*)` по всем root/non-archived invalid rows и вычисляет text `length()` без SQL row cap (`src/kiloDataSource.ts:42-46,303-315`). Он не создаёт result-array или sort, а worker timeout/termination ограничивает lifecycle, поэтому самостоятельным finding не считается; это остаётся CPU/native-I/O residual, который должен быть учтён в финальном resource disposition.

**Влияние:** schema-compatible локальная база всё ещё может заставить SQLite/Node материализовать крупную timestamp value вне заявленного text budget. Поздняя ошибка timed-out path probe может перейти в unhandled rejection. Поэтому доказанного end-to-end resource/error bound пока нет.

### LOW-02 — Output sanitization

**Статус: частично исправлен, остаётся открыт.**

Подтверждённые исправления:

- Добавлен единый `sanitizeDiagnostic()`: Windows absolute paths, UNC и `file:///` URI заменяются на `<local-path>`, control characters ограничиваются, результат обрезается до `4000` characters (`src/diagnostics.ts:1-19`).
- Все exception-bearing host Output paths используют sanitizer: command failure, refresh, workspace refresh/listener, action wrapper/current recheck и `postMessage` (`src/commands.ts:116-119`; `src/kiloHubWebviewProvider.ts:307-318,336-343,373-381,409-416,438-446`; `src/extension.ts:90-93`).
- Raw worker stack сохраняется только во внутреннем Error для диагностики и перед записью в Output проходит sanitizer (`src/kiloDataSource.ts:386-391`; `src/kiloHubWebviewProvider.ts:316`).
- Unit tests подтверждают Windows/UNC/file-URI redaction, control handling и лимит `4000` (`tests/unit/diagnostics.test.ts:6-22`). Static scan не нашёл прямой записи `error.stack`, `String(error)` или прежнего `technicalError()` в Output.

Оставшаяся проблема:

- Общий warning channel обходит sanitizer: `logWarning(source, message)` пишет динамический adapter/projection message напрямую (`src/extension.ts:50-58`). Projection включает source-controlled `session.id`; `diagnosticSessionId()` удаляет controls и обрезает до `128`, но не редактирует path (`src/projection.ts:182-193,214-233,261-283`). Targeted reproduction с ID `C:\Users\Alice\secret` и unsupported directory сформировал Output-bound warning `Session "C:\Users\Alice\secret" пропущена: directory не поддерживается.`. Таким образом, абсолютный локальный path по-прежнему может попасть в Output через schema-valid metadata ID. Tests проверяют только отсутствие newline в warning, но не path redaction (`tests/unit/projection.test.ts:195-215`).

Нужно либо применять `sanitizeDiagnostic(message)` в единой точке `logWarning`, либо гарантировать stable diagnostic code/не включать raw session ID. После этого нужен integration/unit test именно Output boundary, а не только helper.

**Влияние:** exception stacks больше не раскрывают local prefixes, но специально сформированная или повреждённая metadata row всё ещё может вывести path-shaped session ID в diagnostic export/screen sharing.

## Regression evidence

Среда: Windows, Node `v24.13.0`, npm `11.6.2`; Extension Host tests использовали VS Code `1.105.1` и `1.138.0`.

- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` — `0 vulnerabilities`.
- `npm run check-types` — прошёл.
- `npm run lint` — прошёл.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:unit` — `60/60` tests прошли, включая diagnostics и SQL query-plan regressions.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:component` — `29/29` tests прошли, включая 1000-folder heartbeat/chunk cancellation.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:integration:min` — bundle scan прошёл; Extension Host VS Code `1.105.1` exit code `0`.
- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:integration:current` — bundle scan прошёл; Extension Host VS Code `1.138.0` exit code `0`.
- `npm ls --omit=dev --all` — runtime dependency tree пуст.
- `git show --check --oneline 735f06a` — прошёл.
- Static Output scan подтвердил использование `sanitizeDiagnostic()` на всех exception-bearing `appendLine()` paths и выявил unsanitized dynamic warning path в `src/extension.ts:53`.
- Targeted SQL plan — `SCAN session`, без `ORDER BY`/`TEMP B-TREE`.
- Targeted timestamp probe — production query materialизовал `time_created` BLOB как `Uint8Array(1048576)`.
- Targeted projection warning probe — path-shaped session ID сохранился в warning без redaction.
- Targeted Promise semantics probe с `--unhandled-rejections=strict` — отброшенный rejected promise от `operation.finally()` завершил process ошибкой, подтверждая late-rejection defect.

Package/reproducibility/negative VSIX verifier/installed-VSIX tests не запускались: по условию задачи package evidence рассматривается отдельно. Существующий package artifact не используется для disposition этого source commit.

## Счётчики и verdict

- Findings, перенесённые из предыдущего security re-review: `2` (`Medium: 1`, `Low: 1`).
- Полностью закрыты в этом targeted review: `0`.
- Частично исправлены, но остаются открыты: `2` (`MEDIUM-04`, `LOW-02`).
- Новые самостоятельные findings: `0`. Oversized timestamp materialization и late probe rejection являются новым evidence внутри прежнего `MEDIUM-04`; warning-channel bypass является новым evidence внутри прежнего `LOW-02`.
- Текущий targeted severity summary: **Blocker: 0; High: 0; Medium: 1 открыт; Low: 1 открыт.**

Commit `735f06a` устранил полный SQLite `ORDER BY` sort, добавил SQL row/text bounds, ожидаемое worker termination, глобальный OS-probe semaphore и общую sanitization exception diagnostics. Однако заявленные два findings закрыты не полностью. Security source review exit Step 2 **не достигнут** до SQL guards для timestamp types, безопасного late-probe settlement с tests и sanitization общего warning Output boundary. Package exit оценивается отдельно после source security exit.
