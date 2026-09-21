# Финальный security source verdict Step 2

## Объект и scope

- Проверен commit `30c0d5b3a5cacd642cf5cbd447cbe5478b61b5ae` (`fix: achieve Step 2 source review exit`); `HEAD` совпадал с target, tracked worktree до и после проверок был чистым.
- Базовый контекст: `reviews/step2-production-security-rereview-3.md` на commit `928e246`.
- Проверены только два перенесённых finding: `MEDIUM-04` end-to-end resource bounds и `LOW-02` Output sanitization.
- Package, VSIX, reproducibility, archive verification и installed tests исключены из этого source verdict и оцениваются отдельным package gate.

## Disposition

### MEDIUM-04 — end-to-end resource bounds

**Статус: исправлен.**

Evidence:

- Adapter выполняет один bounded metadata query. Предыдущий отдельный invalid-row scan полностью удалён; в production source отсутствуют `INVALID_METADATA_COUNT_QUERY`, второй metadata `SELECT`, `count(*)` и `ORDER BY` (`src/kiloDataSource.ts:20-33,286-317`).
- Query рассматривает только root/non-archived sessions и ограничивает поток `LIMIT 10001`. `.iterate()` не создаёт JS result array; строка `10001` вызывает bounded failure до накопления следующего результата (`src/kiloDataSource.ts:292-315`).
- Text fields не передаются в Node целиком: `CASE typeof(...)` возвращает только `substr(id, 1, 513)`, `substr(title, 1, 4097)` и `substr(directory, 1, 4097)`. Ровно одна дополнительная character позволяет JS validator отличить допустимую границу от превышения, сохраняя per-row memory bound (`src/kiloDataSource.ts:20-23,238-256`).
- Timestamps проходят SQL `typeof(...)= 'integer'` и safe nonnegative range до возвращения значения. TEXT/BLOB/negative/unsafe timestamps становятся `NULL` и изолируются validator как malformed row (`src/kiloDataSource.ts:24-29,232-267`).
- Unit fixture содержит `1 MiB` BLOB в `time_created`; adapter сохраняет единственную точную valid row, пропускает BLOB row и выдаёт bounded warning (`tests/unit/kiloDataSource.test.ts:190-227`).
- Независимый in-memory probe с `1 MiB` timestamp BLOB и title длиной `1 000 000` подтвердил: query plan только `SCAN session`, без `TEMP B-TREE`; result title имеет длину `4097`, `time_created === null`, в metadata query ровно один `SELECT`.
- Query-plan regression запрещает `TEMP B-TREE`/`ORDER BY` и фиксирует exact `LIMIT 10001`, `substr` bounds и timestamp type guards (`tests/unit/kiloDataSource.test.ts:272-288`).
- Общий character budget около `4 MiB`, row budget `10000`, worker V8 old-generation limit `64 MiB`, SQLite busy timeout `5000 ms` и outer worker timeout `10000 ms` сохранены (`src/kiloDataSource.ts:9-18,270-303,331-402`).
- При outer timeout host не отклоняет read promise до resolution/rejection `worker.terminate()`: прежнего fire-and-forget worker lifecycle нет (`src/kiloDataSource.ts:388-402`).
- Глобальный path semaphore сохраняет максимум `16` фактически незавершённых `realpath/stat` operations. После logical timeout permit освобождается только после late settlement; symmetric `operation.then(releasePermit, releasePermit)` обрабатывает и late rejection без нового unhandled promise (`src/windowsPathSafety.ts:14-31,53-90`).
- Deterministic unit regression запускает 16 pending physical probes, удерживает семнадцатый, затем подтверждает transfer одного permit и безопасное завершение всех late `stat` rejection (`tests/unit/windowsPathSafety.test.ts:52-77`).

Ранее открытые подпункты закрыты: нет полного secondary invalid scan, нет native `ORDER BY` sort, oversized metadata не передаётся в Node целиком, timestamp BLOB не материализуется как DTO field, worker termination ожидается, а physical OS probes имеют глобальный max-16 и обработанный late rejection.

### LOW-02 — Output sanitization

**Статус: исправлен.**

Evidence:

- `sanitizeDiagnostic()` заменяет Windows absolute paths, UNC и `file:///` URI на `<local-path>`, нейтрализует control characters и ограничивает diagnostic `4000` characters (`src/diagnostics.ts:1-19`).
- `formatDiagnosticWarning()` дополнительно ограничивает/sanitizes source label и применяет ту же policy к динамическому adapter/projection warning (`src/diagnostics.ts:21-24`).
- Общая warning boundary перед каждым динамическим adapter/projection `appendLine()` вызывает `formatDiagnosticWarning(source, message)` (`src/extension.ts:48-75`). Path-shaped session ID больше не может обойти sanitizer.
- Unit regression проверяет warning с `C:\Users\Alice\secret`: `Alice/secret` отсутствуют, `<local-path>` присутствует (`tests/unit/diagnostics.test.ts:24-32`).
- Static audit всех production `appendLine()` подтвердил: command/provider/workspace exception paths вызывают `sanitizeDiagnostic()`, warning path вызывает `formatDiagnosticWarning()`, остальные строки статичны либо используют закрытый diagnostic enum/внутренне выбранные constant rejection texts (`src/commands.ts:116-119`; `src/extension.ts:50-55,90-93`; `src/kiloHubWebviewProvider.ts:307-318,336-343,373-381,409-416,438-446`).
- Worker stack хранится только во внутреннем Error и не записывается напрямую; перед Output он проходит provider sanitizer (`src/kiloDataSource.ts:360-365`; `src/kiloHubWebviewProvider.ts:316`). Raw path-bearing exception/metadata Output bypass не найден.

Ранее воспроизводимые disclosure через stack и path-shaped warning закрыты. Новых Output channels или обходов sanitizer в target commit не обнаружено.

## Выполненные проверки

Среда: Windows, Node `v24.13.0`, npm `11.6.2`.

- `NODE_TLS_REJECT_UNAUTHORIZED=1 npm run test:unit` — `62/62` tests прошли.
- `npm run check-types` — прошёл.
- `npm run lint` — прошёл.
- `git show --check --oneline 30c0d5b` — прошёл.
- Static query scan — один production metadata `SELECT`; `CASE/substr/type/range/LIMIT 10001` присутствуют; `INVALID_METADATA`, `count(*)`, metadata `.all()` и `ORDER BY` отсутствуют.
- Static Output scan — все dynamic exception/warning callsites используют `sanitizeDiagnostic()` или `formatDiagnosticWarning()`; raw stack/path interpolation не найден.
- Static scope scan — production data source читает только metadata таблицы `session` и schema PRAGMA; message/content queries и mutating SQL не найдены.
- Targeted SQL probe — `SCAN session`, без temporary sort; `1 000 000`-character title ограничен до `4097`, timestamp BLOB преобразован в `NULL`, query содержит один `SELECT`.
- Existing targeted regressions — timestamp BLOB isolation, exact field/row/character bounds, query plan, read-only/WAL/busy/connection lifecycle, semaphore max-16/late rejection и warning path redaction прошли.

Package/release/VSIX/reproducibility/installed evidence не запускалось и не используется для этого verdict согласно scope задачи.

## Счётчики и verdict

- Findings на входе: `2` (`Medium: 1`, `Low: 1`).
- Исправлены: `2` (`MEDIUM-04`, `LOW-02`).
- Остаются открыты: `0`.
- Новые findings: `0`.
- Итоговый source security severity: **Blocker: 0; High: 0; Medium: 0; Low: 0.**

**Source security exit Step 2 достигнут для commit `30c0d5b3a5cacd642cf5cbd447cbe5478b61b5ae`.** Все ранее открытые security source findings закрыты с source, unit и targeted static evidence. Это заключение не является package approval: exact VSIX, reproducibility, archive и installed behavior остаются отдельным последующим gate.
