# Результаты исправлений независимого ревью

## Статус

Три независимых ревью выполнены и повторно проверили изменения. Blocking/high code findings устранены. Единственный открытый release blocker — фактическая clean сборка, двойная проверка воспроизводимости и installed-VSIX smoke нового пакета с worker.

## Требования

| Finding | Решение | Доказательство |
|---|---|---|
| M-1: nondeterministic display path | Исправлено | Display candidate выбирается по timestamp, session ID и path независимо от порядка rows; reorder test проходит. |
| L-1: нет диагностики invalid paths | Исправлено | Projection сообщает обезличенную причину пропуска; control characters ID заменяются и длина ограничивается. |
| L-2: timeout `500`/`5000` | Исправлено | Код, tests и `docs/sqlite-runtime-decision.md` фиксируют `5000 ms` внутри worker. |

## Read-only и безопасность

| Finding | Решение | Доказательство |
|---|---|---|
| HIGH-01: busy timeout блокирует Extension Host | Исправлено | `DatabaseSync` перенесён в отдельный `worker_threads` worker; timer test остаётся responsive при реальном `SQLITE_BUSY`; outer timeout `10000 ms`. |
| MEDIUM-01: mapped/reparse path | Смягчено, остаточный риск принят | Для существующих folders выполняется bounded `realpath/stat`; UNC target отклоняется, concurrency ограничена. Первичный Windows lookup может обратиться к network provider и отмечен в handoff/release limitations. |
| MEDIUM-02: нет resource bounds | Существенно смягчено | Worker heap `64 MB`, outer timeout, metadata length limits, максимум 100 warnings, не более 16 availability checks. SQL по-прежнему материализует все обычные root sessions, чтобы не нарушать полноту требований. |
| LOW-01: relative `KILO_DB` traversal | Принято как compatibility | Поведение повторяет официальный Kilo `path.resolve`; `KILO_DB` является доверенным override и уже допускает absolute paths. Контракт явно уточнён в discovery. |
| LOW-02: Output injection через ID | Исправлено | Control characters экранируются, ID ограничен 128 символами в projection diagnostics, повторные warnings агрегируются. |

## Packaging

| Finding | Решение | Доказательство |
|---|---|---|
| HIGH-1: слабый VSIX verifier | Исправлено | Проверяется точный allow-list, target, identity, engine, activation, commands/views и hashes обоих bundles. |
| MEDIUM-1: имя/version дублируются | Исправлено | Artifact path вычисляется из `package.json` и повторно сверяется verifier. |
| MEDIUM-2: нет clean provenance | Исправлено в script | Packaging отклоняет dirty tree, кроме ожидаемого target artifact. Фактический clean run ожидается. |
| MEDIUM-3: Node/npm не закреплены | Исправлено | `.nvmrc=22.20.0`, `packageManager=npm@11.6.2`, engine range ограничен Node 22.20–24.x. |
| MEDIUM-4: insecure TLS environment | Исправлено для release команд | Lockfile/audit повторены с `NODE_TLS_REJECT_UNAUTHORIZED=1`, 0 vulnerabilities. Clean `npm ci` ожидается. |
| BLOCKER-1: package/repro/install gate | Открыт до release gate | Runner сначала требует exact VSIX verification, использует отдельный installed extension и теперь получает reject при failed refresh. |

## Дополнительный дефект, найденный после ревью

Live adapter probe обнаружил, что реальная Kilo 7.7.5 объявляет `id TEXT PRIMARY KEY`, но `PRAGMA table_info` сообщает `notnull=0`, `pk=1`. Fixture ошибочно использовал явный `NOT NULL`, поэтому старый guard отвергал рабочую базу. Guard исправлен: для `id` требуется primary-key flag, для остальных обязательных fields — точная nullable semantics. Fixture приведён к реальной schema, live worker probe возвращает 31 root session без чтения message bodies.

## Остаточные действия

1. Зафиксировать remediation commit.
2. Выполнить secure-TLS `npm ci` из чистого дерева.
3. Повторить полный automated gate.
4. Дважды собрать одинаковый VSIX и сравнить SHA-256.
5. Установить и проверить именно новый worker-enabled VSIX.
6. Записать результаты в `docs/verification.md`, `handoff.md` и этот отчёт.
