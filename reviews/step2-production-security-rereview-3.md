# Финальное узкое security source-exit review Step 2

## Объект и границы

- Проверен commit `928e24687763a251d31a86bbb67c7dd9b9f3910b` (`fix: close final Step 2 source findings`); `HEAD` совпадал с target, tracked worktree перед проверкой был чистым.
- Базовый контекст: `reviews/step2-production-security-rereview-2.md` на commit `735f06a`.
- Проверены только ранее открытые `MEDIUM-04` и `LOW-02`: SQL timestamp/type/range, invalid-row probe и отсутствие sort; worker termination; глобальный path semaphore и late rejection; warning sanitizer и все production Output paths.
- Package, VSIX, reproducibility и installed evidence явно исключены из scope.
- После прогонов появились параллельные изменения CSS вариантов и другие review-файлы. Они не относятся к commit `928e246`, не использовались как evidence и не изменялись этим review.

## Findings

### MEDIUM-04 — end-to-end resource bounds

**Статус: остаётся открыт; большая часть remediation подтверждена, invalid-row scan не имеет input bound.**

Подтверждённые исправления:

- Production query не содержит `ORDER BY`; targeted `EXPLAIN QUERY PLAN` возвращает только `SCAN session`, без `TEMP B-TREE`. Подходящие результаты ограничены `LIMIT 10001`, затем действуют JS row и global character budgets (`src/kiloDataSource.ts:20-51,320-345`).
- SQL до Node materialization требует integer type и safe nonnegative range для `time_created`/`time_updated` (`src/kiloDataSource.ts:27-30`). Targeted BLOB probe: строка с `Uint8Array(1048576)` в `time_created` не была выбрана production `KILO_METADATA_QUERY`. Range probe выбрал только `Number.MAX_SAFE_INTEGER`, отклонив `-1` и `9007199254740992`. Fixture regression содержит timestamp BLOB размером `1 MiB` и получает warning без session materialization (`tests/unit/kiloDataSource.test.ts:190-227,272-286`).
- Worker timeout больше не fire-and-forget: read promise разрешает timeout error только после resolution/rejection `worker.terminate()` (`src/kiloDataSource.ts:418-432`). Отдельного runtime timeout-injection test нет, но source lifecycle однозначен и прежний дефект устранён.
- Глобальный semaphore выдаёт максимум `16` физических permits. После logical timeout permit удерживается до settlement фактического operation; late success/rejection обрабатывается symmetric `operation.then(releasePermit, releasePermit)`, поэтому новый rejected promise не остаётся без handler (`src/windowsPathSafety.ts:14-31,53-90`).
- Deterministic test запускает 16 зависших realpath probes, подтверждает, что семнадцатый не стартует, затем освобождает один permit, пропускает семнадцатый и завершает все late `stat` rejection без test-runner unhandled rejection (`tests/unit/windowsPathSafety.test.ts:52-77`).

Открытая часть:

- `INVALID_METADATA_COUNT_QUERY` использует `WHERE ... NOT (SQL_VALID_METADATA) LIMIT 101` (`src/kiloDataSource.ts:46-51`). Этот `LIMIT` ограничивает только число **возвращённых invalid rows**, но не число **проверенных input rows**. Чтобы доказать отсутствие invalid row, SQLite должен просканировать все root/non-archived rows; query plan остаётся `SCAN session`.
- Targeted SQLite semantics probe создал `1000` полностью valid rows и добавил side-effect counter к эквивалентному invalid predicate. Результат: `returned: 0`, `visited: 1000`, plan `SCAN session`. То есть `LIMIT 101` не делает scan bounded при числе invalid rows меньше 101.
- Эта secondary query выполняется до bounded production iterator (`src/kiloDataSource.ts:304-322`) и на каждой просмотренной строке вычисляет text `trim/length`. Поэтому большая база из valid rows либо редкий invalid row в конце по-прежнему вызывает полный scan; oversized TEXT также проходит через SQLite `length()` внутри native execution. Worker count и nominal timeout ограничены, но synchronous native query не имеет SQL input bound, а `terminate()` ожидается после timeout и не доказывает немедленное прерывание уже выполняющегося SQLite call.
- Unit test проверяет отсутствие `ORDER BY`, main `LIMIT 10001` и timestamp guards, но не query plan/input count secondary invalid probe (`tests/unit/kiloDataSource.test.ts:272-286`).

Для закрытия нужен реальный input bound до invalid predicate, например гарантированно materialized/неflattened bounded candidate set либо отказ от полного warning probe в пользу bounded sampling/summary. Regression должен доказывать максимальное число просмотренных rows при `0`, `<101` и `>101` invalid rows, а не только длину результата.

**Вывод:** прежний timestamp BLOB bypass и path-probe race закрыты, но end-to-end SQL resource bound всё ещё не замкнут. `MEDIUM-04` остаётся открытым.

### LOW-02 — Output sanitization

**Статус: исправлен.**

Evidence:

- `formatDiagnosticWarning()` sanitizes dynamic source label и пропускает warning message через общий `sanitizeDiagnostic()` с path/control/length policy (`src/diagnostics.ts:1-24`).
- Единственная общая adapter/projection warning boundary теперь вызывает `formatDiagnosticWarning(source, message)` до `output.appendLine()` (`src/extension.ts:48-58,68-75`). Path-shaped `session.id` больше не проходит в Output.
- Unit regression с `Session "C:\Users\Alice\secret"...` подтверждает отсутствие `Alice/secret` и наличие `<local-path>` (`tests/unit/diagnostics.test.ts:24-32`).
- Exception-bearing Output paths продолжают использовать `sanitizeDiagnostic()`: command exception, refresh, workspace recompute/listener, action wrapper/current recheck и `postMessage` (`src/commands.ts:116-119`; `src/extension.ts:90-93`; `src/kiloHubWebviewProvider.ts:307-318,336-343,373-381,409-416,438-446`).
- Static scan всех `appendLine()` нашёл только: sanitized exception interpolation, sanitized warning boundary, controlled enum `current.diagnostic`, internally selected constant rejection strings и полностью статические сообщения. Raw worker `error.stack` сохраняется только во внутреннем Error и до Output проходит provider sanitizer (`src/kiloDataSource.ts:390-395`). Прямой записи raw stack/path-bearing metadata в Output не найдено.

**Вывод:** ранее воспроизводимый warning-channel path disclosure устранён; `LOW-02` закрыт.

## Выполненные проверки

Среда: Windows, Node `v24.13.0`, npm `11.6.2`.

- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:unit` — `62/62` tests прошли.
- `npm run check-types` — прошёл.
- `npm run lint` — прошёл.
- `git show --check --oneline 928e246` — прошёл.
- Static scan `src/**/*.ts` — production metadata SQL не содержит `ORDER BY`; timestamp guards и оба SQL limits присутствуют; raw exception Output bypass не найден.
- Targeted production-query BLOB probe — plan `SCAN session`, без temporary sort; строка с `1 MiB` timestamp BLOB не выбрана.
- Targeted timestamp range probe — выбрана только строка с `9007199254740991`; negative и unsafe integer исключены.
- Targeted invalid-query semantics probe — на `1000` valid rows `LIMIT 101` вернул `0`, но predicate посетил все `1000`; plan `SCAN session`.
- Path semaphore/late rejection — прошёл новый deterministic unit regression max-16.
- Warning boundary — прошёл новый path-shaped session ID unit regression и static Output-callsite audit.

Не запускались package, release, VSIX verifier, reproducibility или installed tests: package evidence рассматривается отдельным этапом и не влияет на этот source disposition.

## Счётчики и source-exit verdict

- Findings на входе: `2` (`Medium: 1`, `Low: 1`).
- Исправлены: `1` (`LOW-02`).
- Остаются открыты: `1` (`MEDIUM-04`).
- Новые самостоятельные findings: `0`. Семантика `LIMIT` является остатком того же end-to-end resource finding, а не новым ID.
- Текущий targeted severity summary: **Blocker: 0; High: 0; Medium: 1 открыт; Low: 0.**

Commit `928e246` закрывает timestamp BLOB/range bypass, worker termination ordering, late path rejection/max-16 semaphore и все найденные Output sanitization paths. Однако secondary invalid-row query всё ещё допускает полный input scan до main bounded iterator. Поэтому **source security exit Step 2 не достигнут**. Package exit остаётся отдельно исключённым до закрытия `MEDIUM-04`.
