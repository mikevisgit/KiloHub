# Discovery локального storage Kilo

## Результат

На машине разработки подтверждена Kilo Code `7.7.5` и активная база:

```text
C:\Users\GRAM\.local\share\kilo\kilo.db
C:\Users\GRAM\.local\share\kilo\kilo.db-wal
C:\Users\GRAM\.local\share\kilo\kilo.db-shm
```

База работает в WAL-режиме и одновременно открывается read-only connection при запущенном Kilo. Отдельный `kilo` отсутствует в `PATH`; private executable установленного расширения применялся только как discovery oracle.

## Проверенная среда

| Компонент | Значение |
|---|---|
| Windows | PowerShell `5.1.26100.9444` |
| VS Code Stable | `1.138.0`, x64 |
| Extension Host | Node.js `24.18.1`, Electron `42.10.0`, SQLite `3.53.1` |
| Standalone Node.js | `24.13.0`, SQLite `3.50.4` |
| Kilo Code | `7.7.5-win32-x64` |
| Активные overrides | `KILO_DB`, `XDG_DATA_HOME`, `KILO_DISABLE_CHANNEL_DB` не заданы |

## Определение пути

Код Kilo 7.7.5 задаёт такой порядок:

1. Data root берётся из `XDG_DATA_HOME`, иначе используется `%USERPROFILE%\.local\share`.
2. К data root добавляется каталог `kilo`.
3. Если задан `KILO_DB`, значение `:memory:` означает in-memory database, абсолютный путь используется напрямую, относительный передаётся `path.resolve` с каталогом `kilo` как base. Как и официальный Kilo 7.7.5, такой override может содержать `..`; `KILO_DB` считается доверенной пользовательской настройкой.
4. Для release channels `latest`, `beta`, `prod` или при `KILO_DISABLE_CHANNEL_DB=true|1` используется `kilo.db`.
5. Для другого build-time channel используется `kilo-<channel>.db`; при отсутствии нового файла возможен legacy fallback `opencode-<channel>.db`.

`KILO_CHANNEL` в версии 7.7.5 является build-time constant, а не runtime environment variable. Установка одноимённой переменной среды не переключает базу. Реальные runtime overrides: `KILO_DB`, `XDG_DATA_HOME`, `KILO_DISABLE_CHANNEL_DB`.

Portable mode VS Code сам по себе не переносит Kilo storage. Без явного override используется профиль пользователя Windows.

Production resolver Step 1 поддерживает однозначные runtime-входы текущего локального environment: `KILO_DB`, `XDG_DATA_HOME` и стандартный release path. `:memory:` отклоняется, потому что отдельный Extension Host не может разделить in-memory connection Kilo. Неизвестный channel нельзя угадывать перебором нескольких баз: пользователь должен передать точный `KILO_DB`. Относительный override намеренно повторяет semantics официального `path.resolve`, а не реализует security sandbox; для ограничения каталогом следует использовать корректный путь без `..`.

## Schema таблицы `session`

Фактическая таблица содержит 29 колонок. Step 1 использует только следующий обязательный контракт:

| Колонка | Тип | Nullable | Назначение |
|---|---|---|---|
| `id` | `TEXT` | primary key (`PRAGMA table_info.notnull=0`, `pk=1`) | ID диалога |
| `directory` | `TEXT` | нет | связь с локальной папкой |
| `title` | `TEXT` | нет | сохранённое название |
| `parent_id` | `TEXT` | да | исключение дочерних sessions |
| `time_created` | `INTEGER` | нет | Unix milliseconds |
| `time_updated` | `INTEGER` | нет | Unix milliseconds, сортировка |
| `time_archived` | `INTEGER` | да | исключение архива |

В таблице также присутствуют `project_id`, `workspace_id`, `slug`, `path`, `version`, summary/token/model metadata и другие поля. Они не нужны Step 1 и не выбираются.

Индексы фактической schema:

```text
session_project_idx(project_id)
session_workspace_idx(workspace_id)
session_parent_idx(parent_id)
PRIMARY KEY(id)
```

## Metadata-only запрос

```sql
SELECT
  id,
  title,
  directory,
  time_created,
  time_updated,
  parent_id,
  time_archived
FROM session
WHERE parent_id IS NULL
  AND time_archived IS NULL
ORDER BY time_updated DESC;
```

Запрос не обращается к таблицам messages, parts или transcript. На рабочей базе он вернул 31 root/non-archived session примерно за `1.1 ms`; открытие connection и schema guard заняли менее `8 ms` суммарно в конкретном замере. Эти числа являются discovery evidence, а не универсальным performance budget.

Production Step 2 сохраняет тот же набор колонок и фильтр root/non-archived, но не выполняет SQLite `ORDER BY`: точная сортировка делается presenter после bounded materialization. SQL дополнительно отсекает metadata-поля длиннее `id=512`, `title/directory=4096` и использует `LIMIT 10001`; строка 10001 приводит к контролируемой ошибке вместо частичного списка. Это исключает полный temporary B-tree до применения JS budgets. Общий текстовый бюджет результата ограничен примерно 4 MiB.

## Schema guard

SQLite `user_version=0`, `application_id=0`, а `schema_version` является внутренним counter и не кодирует версию Kilo. Поле `session.version` относится к создателю отдельной session и также не является версией schema.

Guard выполняется до metadata-запроса:

1. Если установлен `kilocode.kilo-code`, версия ниже `7.7.5` отклоняется.
2. Проверяется, что `session` является таблицей.
3. Через `PRAGMA table_info(session)` проверяются обязательные колонки и типы. Для `id` требуется `pk>0`: SQLite сообщает `notnull=0` для фактического `TEXT PRIMARY KEY`. Для `directory`, `title`, `time_created`, `time_updated` требуется `NOT NULL`; parent/archive остаются nullable.
4. Дополнительные колонки разрешены для forward compatibility.
5. Подготавливается точный metadata-only `SELECT`; ошибка подготовки означает несовместимую schema.
6. Migration IDs допустимы только как диагностический fingerprint, но не как единственный guard.

Если Kilo extension отсутствует, структурно совместимая база может быть создана Kilo CLI и принимается по schema signature. Это соответствует границе «текущая локальная Kilo database/environment», а не одному профилю VS Code.

## CLI oracle

Для discovery использовалась точная команда:

```powershell
& 'C:\Users\GRAM\.vscode\extensions\kilocode.kilo-code-7.7.5-win32-x64\bin\kilo.exe' `
  session list --all --max-count 10000 --format json
```

Результат сравнения на 31 session:

```json
{
  "cliCount": 31,
  "sqlCount": 31,
  "missingSql": [],
  "missingCli": [],
  "mismatch": []
}
```

Сравнивались `id`, `title`, нормализованный `directory`, `created`, `updated`; пользовательские titles не выводились в диагностический отчёт.

CLI не используется в runtime. Его общий startup выполняет `PRAGMA journal_mode = WAL`, `PRAGMA wal_checkpoint(PASSIVE)` и недостающие migrations, поэтому oracle запускается только на изолированной test environment и не является доказательством физически strict read-only процесса.

## WAL и Refresh

Каждый refresh:

1. заново определяет путь;
2. создаёт короткоживущий worker thread и в нём открывает read-only connection;
3. включает connection-local `PRAGMA query_only = ON`;
4. проверяет schema;
5. полностью материализует один metadata result set;
6. закрывает connection в `finally`, возвращает только metadata и завершает worker;
7. нормализует и группирует данные вне SQLite;
8. атомарно заменяет in-memory UI model.

Запрещены migrations, checkpoint, изменение `journal_mode`, `immutable=1`, `nolock=1` и копирование только основного DB-файла без WAL/SHM. `SQLITE_BUSY` обрабатывается как временная ошибка с ручным повтором через `Refresh`.

## Источники

- Kilo 7.7.5 `packages/core/src/global.ts`.
- Kilo 7.7.5 `packages/core/src/database/database.ts`.
- Kilo 7.7.5 `packages/core/src/flag/flag.ts`.
- Kilo 7.7.5 `packages/core/src/installation/version.ts`.
- Kilo 7.7.5 `packages/core/src/session/sql.ts`.
- Официальная документация SQLite WAL и URI parameters.
- Локальная read-only проверка рабочей базы и сравнение с CLI oracle 20.09.2026.
