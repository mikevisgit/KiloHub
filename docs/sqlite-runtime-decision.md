# Решение по SQLite runtime

## Статус

Выбран runtime для реализации и packaging spike: встроенный модуль `node:sqlite`. Решение станет окончательно подтверждённым после теста внутри Extension Host минимальной поддерживаемой версии VS Code и проверки установленного VSIX.

## Решение

- Runtime SQLite: `node:sqlite`, класс `DatabaseSync`.
- Открытие в отдельном worker thread: `{ readOnly: true, timeout: 5000, allowExtension: false }`.
- Минимальная кандидатная версия VS Code: `1.105.1`.
- Extension Host этой версии: Electron `37.6.0`, Node.js `22.19.0`.
- Production bundle: CommonJS, target `node22`, модули `vscode` и `node:sqlite` остаются external.
- Runtime npm dependencies отсутствуют.
- Первый дистрибутив: `win32-x64`.

## Причины

`node:sqlite` уменьшает поставляемую поверхность: VSIX не содержит `.node`-бинарники, WASM, loader сторонней базы, компилятор или postinstall. Архитектурную совместимость обеспечивает сам локальный VS Code. Read-only задаётся SQLite при открытии connection, а `timeout` ограничивает ожидание busy lock. Синхронная connection живёт только в отдельном `worker_threads` worker, поэтому busy timeout не блокирует event loop Extension Host.

Обычное открытие файла видит `kilo.db-wal` и `kilo.db-shm`. SQLite URI option `immutable=1` не используется: для живой WAL-базы он может привести к игнорированию актуальных изменений.

## Отклонённые варианты

| Вариант | Причина отклонения |
|---|---|
| `sql.js` | Загружает основной файл как snapshot в память и не обеспечивает корректное чтение живой WAL-базы. |
| `@sqlite.org/sqlite-wasm` | Node-сценарий ориентирован на in-memory DB, а не на существующую работающую базу с sidecars. |
| `sqlite3` | Native addon, архивированный upstream и platform-specific prebuilds. |
| `better-sqlite3` | Дополнительные ABI, binary packaging и supply-chain риски; оставлен только резервом. |
| `@vscode/sqlite3` | Native fork с `node-gyp rebuild`; приватную копию VS Code импортировать нельзя. |
| Внешний `sqlite3.exe` | Дополнительный executable, process management и более широкая поверхность поставки. |

## Обязательные проверки

1. `require('node:sqlite')` проходит внутри Extension Host VS Code `1.105.1`.
2. `DatabaseSync` открывает fixture с `readOnly: true` и не создаёт файлы.
3. Попытка записи через test probe завершается SQLite read-only error.
4. Committed запись, находящаяся в WAL, видна reader.
5. Database/WAL/SHM остаются неизменными после чтения без активного writer.
6. Busy handling ограничен по времени и не зависает.
7. Connection закрывается в `finally` при успехе и ошибке.
8. Такой же runtime загружается из установленного VSIX.
9. Таймер Extension Host продолжает выполняться, пока worker ожидает `SQLITE_BUSY`.

## Packaging

Положительный allow-list задаётся полем `files` в `package.json`; `.vscodeignore` не используется. VSIX не должен содержать `src/`, `tests/`, fixtures, `node_modules/`, `req/`, `specs/`, `reviews/`, `.map`, базы или sidecar-файлы.

Команда выпуска:

```powershell
$env:SOURCE_DATE_EPOCH = git log -1 --pretty=%ct
npm exec -- vsce package --target win32-x64 --no-dependencies --out "dist/kilo-hub-0.1.0-win32-x64.vsix"
```

Перед выпуском состав проверяется через `vsce ls --tree --no-dependencies` и непосредственное чтение ZIP entries. Для итогового файла записываются абсолютный путь, размер и SHA-256.

## Остаточные риски

- В Node 22 API `node:sqlite` имеет статус active development, поэтому Extension Host test обязателен.
- `DatabaseSync` синхронный внутри короткоживущего worker; создание worker и производительность проверяются до приёмки.
- Совместимость `1.105.1` пока является кандидатной и не отмечается пройденной до фактического запуска downloaded test host.
