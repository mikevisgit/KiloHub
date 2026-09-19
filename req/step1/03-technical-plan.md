# Технический план Step 1

## 1. Архитектурный принцип

Hub строит read-only projection локальной активности Kilo:

```text
Kilo data source → Kilo adapter → normalize/group → TreeDataProvider → VS Code UI
```

Kilo остаётся единственным источником истины. Hub не создаёт собственный пользовательский реестр папок и не меняет Kilo storage.

`Kilo adapter` читает metadata из локальной `kilo.db` через read-only SQLite connection. Официальный CLI используется только в Discovery как oracle с фиксированным `--max-count 10000`. Hub не зависит от отдельной установки CLI и не использует private runtime VS Code-расширения Kilo.

## 2. Стек

- TypeScript;
- Node.js runtime Extension Host;
- `@types/vscode`;
- `TreeDataProvider`;
- SQLite adapter к локальной `kilo.db`;
- `@vscode/vsce` для сборки `.vsix`;
- unit и extension integration tests.

React, webview, собственная SQLite Hub и отдельный backend не нужны. Чтение существующей `kilo.db` не означает создание собственной базы Hub.

## 3. Возможная структура

```text
kilo-hub/
  package.json
  tsconfig.json
  src/
    extension.ts
    kiloDataSource.ts
    kiloDataAdapter.ts
    folderTreeProvider.ts
    commands.ts
    types.ts
  test/
    fixtures/
    kiloDataAdapter.test.ts
    folderTreeProvider.test.ts
    extension.test.ts
  resources/
    hub.svg
```

Точные файлы зависят от найденного интерфейса Kilo. Не следует добавлять абстракции, которые не нужны для одного подтверждённого источника.

## 4. Команды

| Command ID | Назначение |
|---|---|
| `kiloHub.refresh` | Повторно прочитать активность Kilo |
| `kiloHub.openHere` | Открыть папку в текущем окне |
| `kiloHub.openNewWindow` | Открыть папку в новом окне |
| `kiloHub.openInFileExplorer` | Открыть папку в Проводнике Windows |

Команд добавления, удаления, скрытия и импорта папок нет.

## 5. Алгоритм обновления

1. Определить путь к текущей `kilo.db`, проверить schema/version и открыть WAL-aware read-only connection.
2. Для каждой записи извлечь `session.id`, `session.title`, `session.directory`, timestamps, `parent_id` и `time_archived`.
3. Оставить только записи с `parent_id IS NULL` и `time_archived IS NULL`; отбросить записи без валидного `session.directory`, `.code-workspace`, remote URI и UNC-пути.
4. Нормализовать локальный путь Windows.
5. Сгруппировать диалоги по нормализованному пути.
6. Отбросить пустые группы.
7. Проверить доступность локальных путей.
8. Отсортировать папки и диалоги.
9. Атомарно заменить in-memory model и обновить `Kilo Folders`; отсутствующие в новой выборке sessions и опустевшие группы удалить.

При ошибке обновления connection закрывается, а уже показанная корректная модель может остаться в памяти до следующего refresh, но не должна записываться как независимый реестр.

## 6. Нормализация и группировка

- использовать нормализованный локальный путь как основной идентификатор папки;
- сравнивать Windows paths без учёта регистра;
- учитывать separator и trailing separator;
- принимать только локальные пути и `file` URI текущей Windows-среды;
- исключать `.code-workspace`, multi-root, remote URI и UNC-пути;
- объединять дубли одного диалога по `session.id`;
- не группировать запись, если связь с папкой неоднозначна;
- вычислять label папки из локального пути, не из текста диалога.

Discovery должен подтвердить, как надёжно распознавать неподдерживаемые типы связи, но они не входят в Step 1.

## 7. Работа с title

Приоритет:

1. явное сохранённое название диалога Kilo;
2. defensive fallback `Без названия` для повреждённого пустого значения с записью предупреждения в Output Channel.

Hub не генерирует название через LLM и не читает сообщения для самостоятельной суммаризации.

## 8. Открытие папки

Перед открытием Hub проверяет URI и доступность локального пути.

Текущее окно:

```ts
vscode.commands.executeCommand(
  'vscode.openFolder',
  folder.uri,
  { forceReuseWindow: true }
);
```

Новое окно:

```ts
vscode.commands.executeCommand(
  'vscode.openFolder',
  folder.uri,
  { forceNewWindow: true }
);
```

Проводник Windows:

```ts
vscode.env.openExternal(folderUri);
```

При `Open Here` текущий Extension Host будет завершён самим VS Code. Hub не должен планировать обязательную запись состояния после вызова команды.

## 9. Кэширование

По умолчанию достаточно in-memory model. Технический disk cache допускается только если чтение Kilo заметно медленное.

Такой кэш:

- не является пользовательским реестром;
- полностью восстанавливается из Kilo;
- имеет версию и source fingerprint;
- инвалидируется при несовместимой версии Kilo;
- не используется для сохранения вручную добавленных или скрытых папок.

## 10. Тесты

### Unit

- parser/adapter на обезличенных fixtures Kilo;
- записи с title и без title;
- записи со связью с папкой и без неё;
- исключение дочерних и архивных sessions;
- исключение `.code-workspace`, remote URI и UNC-путей;
- группировка нескольких диалогов одной папки;
- исключение группы без диалогов;
- дедупликация;
- сортировка по timestamp и fallback по имени;
- нормализация локальных Windows path и file URI;
- missing path state;
- повреждённая запись;
- неизвестная версия схемы.
- Kilo ниже 7.7.5 и несовместимая более новая schema;
- read-only SQLite connection, WAL и busy error;
- сверка SQLite результата с fixture официального CLI;

### Extension integration

- регистрация `Kilo Folders` и command IDs;
- refresh заменяет модель данными adapter;
- верхний уровень содержит только имена папок;
- раскрытая папка содержит путь, три действия и строки диалогов;
- папка без conversations не появляется;
- диалог отображает title;
- options `vscode.openFolder` соответствуют выбранному режиму;
- `Open in File Explorer` вызывает стандартный API VS Code;
- Hub не выполняет write в Kilo data source.

### Ручной smoke test

- установка `.vsix` в отдельный VS Code profile, запущенный с изолированной тестовой Kilo database/environment через подтверждённый override;
- несколько реальных папок с разным количеством Kilo-диалогов;
- контрольная папка без Kilo-диалогов;
- создание нового диалога и `Refresh`;
- изменение title и `Refresh`;
- удаление session и `Refresh`;
- открытие папки в текущем окне, новом окне и Проводнике Windows;
- удалённая папка с оставшейся историей;
- путь с пробелами и не-ASCII символами;
- работа при одновременно открытом Kilo.

## 11. Сборка

Ожидаемый pipeline:

```powershell
npm ci
npm run lint
npm test
npm run package
```

Результат: версионированный файл вида `kilo-hub-0.1.0.vsix`.

## 12. Порядок реализации

1. Выполнить `kilo.db`/SQLite Discovery spike в Extension Host.
2. Зафиксировать Kilo 7.7.5 как minimum, schema guard для новых версий и SQLite runtime.
3. Создать обезличенные fixtures.
4. Реализовать read-only Kilo adapter.
5. Реализовать нормализацию и группировку.
6. Реализовать плоский список папок с раскрываемыми нативными деталями.
7. Добавить `Refresh` и три команды открытия.
8. Обработать missing paths и частично повреждённые данные.
9. Добавить тесты.
10. Собрать и проверить `.vsix` на чистом profile.

## 13. Оценка

Точная оценка зависит от интерфейса Kilo:

- Discovery и read-only spike: 1–2 дня;
- adapter и модель данных: 1–2 дня;
- `Kilo Folders`, раскрываемые детали и команды открытия: 1–2 дня;
- тесты, packaging и smoke test: 1 день.

Срок зависит прежде всего от выбора SQLite runtime для Windows VSIX, корректного WAL-safe read-only доступа и сложности schema guard. Поддержка нескольких несовместимых схем не входит в Step 1.
