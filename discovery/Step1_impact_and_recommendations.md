# Влияние существующих решений на Step 1

Дата анализа: 2026-09-20.

Исходный материал: [`Kilo_Hub_existing_solutions_research.md`](./Kilo_Hub_existing_solutions_research.md).

Управляющие документы: [`01-requirements.md`](../req/step1/01-requirements.md) и [`02-discovery.md`](../req/step1/02-discovery.md).

## 1. Краткий вывод

Исследование не является основанием расширять Step 1. Напротив, оно подтверждает выбранный минимальный scope:

- Kilo остаётся единственным источником состава списка;
- Hub строит read-only представление, а не собственный реестр проектов;
- Step 1 не индексирует тексты сообщений;
- summary, поиск, FTS, embeddings, Hub API, MCP и открытие конкретного диалога откладываются;
- сторонние решения используются как источник проверенных подходов, но не становятся runtime-зависимостями без отдельного обоснования.

Главное влияние на реализацию — выбор источника данных. В проверенной Kilo `7.7.5` хранятся обязательные `id`, `title` и `directory`, а также timestamps и состояние архивирования. Timestamp полезен для сортировки, но его отсутствие не должно блокировать отображение. Runtime adapter обязан проверять поддерживаемую schema/version, а не переносить это утверждение на все версии Kilo.

Предлагаемое решение:

1. Не расширять функциональный scope Step 1.
2. Переутвердить границу данных: читать текущую local Kilo database/environment, а не текущий VS Code profile.
3. Для поставки одним VSIX сначала проверить metadata-only read-only SQLite adapter; официальный CLI использовать как oracle и optional source.
4. Не добавлять runtime-зависимости на исследованные сторонние расширения.

## 2. Что в исходном исследовании относится к более позднему продукту

Исходный документ смешивает Step 1 и долгосрочную концепцию Kilo Hub. Следующие идеи не входят в утверждённый Step 1:

| Идея из исследования | Решение для Step 1 |
|---|---|
| Собственный реестр проектов | Не создавать; список выводится только из истории Kilo |
| VS Code `Open Recent` как источник проектов | Не использовать |
| `Hub Indexer` и постоянный `Local Hub Index` | Не создавать; по умолчанию достаточно in-memory модели |
| Карточки проектов с summary | Не делать |
| Поиск по имени, пути, summary или тексту диалогов | Не делать |
| SQLite FTS5, BM25, embeddings и RAG | Не делать |
| Hub API, CLI, MCP и Kilo tools | Отложить |
| Открытие или продолжение конкретной Kilo session | Отложить |
| Поддержка других coding agents | Отложить |
| Один клик по папке открывает проект | Не применять: обычный клик раскрывает детали |
| История проекта на отдельном экране | Не делать: названия диалогов отображаются в раскрытых деталях |

Термин `project` в исходном исследовании шире принятой модели Step 1. В Step 1 верхнеуровневой сущностью является нормализованная локальная папка Windows, для которой найден хотя бы один обычный Kilo-диалог.

## 3. Что полезно применить уже в Step 1

### 3.1 Выбирать источник до реализации UI

По стабильности контракта кандидаты располагаются так:

1. официальный CLI `kilo session list --all --max-count <N> --format json`, если отдельный CLI установлен;
2. read-only чтение документированной локальной SQLite database, если установлен только VS Code extension;
3. отдельно запущенный и аутентифицированный `kilo serve` только если процесс уже является частью среды пользователя;
4. private bundled runtime VS Code-расширения не использовать как контракт.

По удобству поставки VSIX порядок другой: SQLite доступна вместе с локальной историей, а отдельный CLI может отсутствовать. Поэтому runtime-выбор должен быть принят после Windows packaging spike, а не только по качеству интерфейса.

Публичного data API у VS Code-расширения Kilo сейчас нет. Пригодный источник должен возвращать стабильный ID, title, directory, archive/parent state и поддерживать ручное повторное чтение без загрузки transcript. Timestamp желателен, но не является блокером.

### 3.2 Сохранить границу между источником и UI

Минимальная архитектура остаётся такой:

```text
Kilo source -> Kilo adapter -> normalize/filter/group -> TreeDataProvider -> Kilo Folders
```

`Kilo adapter` должен скрывать конкретный формат Kilo. UI не должен знать пути к storage, SQL-схему или формат CLI-вывода.

Минимальный контракт адаптера:

```ts
type KiloConversationRecord = {
  id: string;
  title: string;
  updatedAt?: string;
  folderPath: string;
};

interface KiloConversationSource {
  readConversations(): Promise<KiloConversationRecord[]>;
}
```

Это нормализованный контракт уже после source-specific filtering. SQLite adapter фильтрует `parent_id` и `time_archived`; CLI adapter получает уже отфильтрованные global results. Соответствие root session понятию «обычный диалог» нужно один раз подтвердить сравнением с Kilo History UI. Удалённый диалог отдельного durable-флага не имеет: после удаления строки нет в источнике.

### 3.3 Не добавлять стороннюю runtime-зависимость без необходимости

Даже если существующее расширение уже умеет индексировать историю, зависимость оправдана только при одновременном выполнении условий:

- есть стабильный программный интерфейс;
- лицензия разрешает выбранный способ использования;
- поддерживается актуальный Kilo;
- доступны нужные metadata без transcript;
- зависимость не требует отдельного сервиса или постоянного индекса для Step 1;
- поведение при отсутствии или несовместимой версии зависимости определено.

Для Step 1 предпочтительнее небольшой собственный adapter к подтверждённому источнику Kilo, чем зависимость от полноценного поискового продукта.

### 3.4 Переиспользовать паттерны, а не продукт целиком

Из project manager и history viewer решений полезны:

- регистрация Activity Bar container и нативного view;
- команды открытия папки в текущем и новом окне;
- обработка missing path;
- нормализация Windows paths;
- асинхронное чтение и атомарная замена модели;
- тестирование адаптера на обезличенных fixtures.

Не следует заимствовать для Step 1:

- собственный список избранных проектов;
- сканирование каталогов;
- импорт `Open Recent`;
- теги и ручное управление;
- постоянный поисковый индекс;
- чтение полного текста диалогов.

## 4. Проверенные существующие решения

Факты в этом разделе проверены 2026-09-20. Для Kilo использован официальный repository snapshot `010f511d731df2649bb3f9b660e309ea7e869ac8`; сведения о сторонних решениях являются снимком их изменяемых репозиториев на дату проверки.

### 4.1 Kilo Code

Официальные документация и код snapshot Kilo `7.7.5` подтверждают, что нужная Step 1 metadata существует:

- документация: [Session History and Search](https://kilo.ai/docs/code-with-ai/agents/session-history);
- проверенный commit: [`010f511d`](https://github.com/Kilo-Org/kilocode/tree/010f511d731df2649bb3f9b660e309ea7e869ac8), VS Code package version `7.7.5`;
- schema session: [`packages/core/src/session/sql.ts`](https://github.com/Kilo-Org/kilocode/blob/010f511d731df2649bb3f9b660e309ea7e869ac8/packages/core/src/session/sql.ts);
- CLI implementation: [`packages/opencode/src/cli/cmd/session.ts`](https://github.com/Kilo-Org/kilocode/blob/010f511d731df2649bb3f9b660e309ea7e869ac8/packages/opencode/src/cli/cmd/session.ts).

Таблица `session` содержит `id`, `project_id`, optional `parent_id`, обязательные `directory` и `title`, created/updated timestamps и optional `time_archived`. Корневые неархивные диалоги соответствуют фильтру `parent_id IS NULL AND time_archived IS NULL`.

Актуальный локальный источник — SQLite database `kilo.db`, по умолчанию на Windows:

```text
%USERPROFILE%\.local\share\kilo\kilo.db
```

Возможны overrides через `KILO_DB`, `XDG_DATA_HOME`, development channels и изолированные environments. База использует WAL/SHM sidecars. Официальная troubleshooting-документация подтверждает, что в ней находится история IDE extension: [SQLite database is malformed](https://kilo.ai/docs/getting-started/troubleshooting/troubleshooting-extension#sqlite-database-is-malformed).

Официальный CLI предоставляет подходящий metadata-only запрос:

```powershell
kilo session list --all --max-count 10000 --format json
```

Важно указывать `--max-count`: default global limit равен 100. JSON содержит `id`, `title`, `updated`, `created`, `projectId`, `directory` и project metadata. По умолчанию global listing уже исключает child sessions и archived sessions. CLI не следует считать полным источником без стратегии обнаружения усечения: spike должен увеличивать limit, пока возвращённое количество меньше него, либо предпочесть SQL без искусственного лимита.

Ограничения:

- отдельный CLI не устанавливается автоматически вместе с VS Code extension;
- `activate()` VS Code extension не экспортирует публичный API;
- contributed History command открывает UI, но не возвращает данные;
- bundled server/runtime расширения является private implementation detail;
- documented `kilo serve` требует отдельного запуска и аутентификации;
- открыть конкретную session через публичный VS Code command нельзя.

**Влияние на Step 1:** требуемая projection технически доступна. Для среды только с VS Code extension наиболее реалистичен read-only SQLite adapter. CLI adapter проще и стабильнее, но может быть только optional fast path либо требует явной зависимости на установленный CLI.

Ещё одно обязательное изменение предположений: storage не привязан к текущему VS Code profile. Обычно разные локальные профили и Stable/Insiders видят одну local Kilo database, если environment overrides не разделяют их. Корректная граница Step 1 — **текущая локальная Kilo database/environment**, а не текущий профиль VS Code.

### 4.2 Chat Wizard

Проверено по репозиторию [`Veverke/ChatWizard`](https://github.com/Veverke/ChatWizard), опубликованная версия [`v1.6.0`](https://github.com/Veverke/ChatWizard/releases/tag/v1.6.0):

- это активно публикуемое VS Code-расширение для агрегации истории нескольких coding agents;
- текущий список источников в [`src/types/index.ts`](https://github.com/Veverke/ChatWizard/blob/master/src/types/index.ts) не содержит Kilo Code;
- архитектура разделяет readers, parsers, canonical session model и UI, но основной runtime находится внутри Extension Host;
- используются in-memory index и SQLite cache/FTS, полный текст сообщений и дополнительные поисковые функции;
- готового Kilo adapter или стабильного внешнего CLI нет.

Лицензия — MIT с Commons Clause, то есть source-available с ограничением коммерческого использования: [`LICENSE`](https://github.com/Veverke/ChatWizard/blob/master/LICENSE). Код нельзя считать обычным unrestricted MIT-компонентом.

**Влияние на Step 1:** не использовать как зависимость и не рассчитывать на готовую поддержку Kilo. Полезны только общие паттерны `reader -> parser -> canonical model`, изоляция ошибок записи и fixtures для разных версий источника.

### 4.3 Callimachus

Проект однозначно идентифицирован как [`BetaBots-LLC/callimachus`](https://github.com/BetaBots-LLC/callimachus), опубликованная версия [`v0.11.0`](https://github.com/BetaBots-LLC/callimachus/releases/tag/v0.11.0). В отличие от Chat Wizard, он содержит Kilo indexer для старого task-layout:

- indexer: [`apps/desktop/src-tauri/src/indexer/kilo.rs`](https://github.com/BetaBots-LLC/callimachus/blob/main/apps/desktop/src-tauri/src/indexer/kilo.rs);
- общий Cline/Roo/Kilo parser: [`apps/desktop/src-tauri/src/indexer/cline.rs`](https://github.com/BetaBots-LLC/callimachus/blob/main/apps/desktop/src-tauri/src/indexer/cline.rs);
- Extension ID Kilo: `kilocode.kilo-code`;
- обнаруживаемый путь: `<VS Code user data>/globalStorage/kilocode.kilo-code/tasks/<id>/`;
- transcript: `api_conversation_history.json`;
- metadata: `task_metadata.json`;
- связь с папкой: поле `cwd` в metadata.

Официальный Kilo 7.7.5 использует общую SQLite database, а JSON task-файлы присутствуют только в migration paths. Поэтому этот reader полезен для понимания legacy-формата, но не является подходящим источником актуальной истории Kilo.

Callimachus использует более широкую архитектуру:

```text
source indexers -> shared SQLite index -> desktop / cal CLI / MCP / VS Code client
```

Его VS Code-клиент тонкий и вызывает собственный `cal`, а не официальный CLI Kilo. Сам `cal` не является доказательством возможностей Kilo CLI; наличие `kilo session list` подтверждено отдельно официальными источниками Kilo.

Полезные идеи:

- отдельный source adapter для Kilo;
- отделение metadata от transcript в source-specific parser;
- уникальность диалога по source ID;
- изоляция source-specific parser;
- read-only клиенты поверх уже построенного индекса;
- явная миграция схемы и version-aware parsing.

Что не следует переносить в Step 1:

- собственный SQLite index;
- FTS, embeddings и semantic search;
- CLI/MCP слой;
- нормализацию папки до ближайшего Git root: Step 1 показывает фактическую папку Kilo, а не вычисленный repository project;
- индексирование полного transcript.

Лицензия Callimachus — [`AGPL-3.0-or-later`](https://github.com/BetaBots-LLC/callimachus/blob/main/LICENSE), также заявлена отдельная коммерческая лицензия. Прямое копирование кода требует отдельного лицензионного решения. Для Step 1 безопаснее независимо реализовать минимальный adapter после проверки формата.

### 4.4 Предварительная reuse map

| Компонент | Kilo official | Chat Wizard | Callimachus | Решение Step 1 |
|---|---|---|---|---|
| Готовый Kilo reader | CLI JSON и documented SQLite | Нет | Legacy task-file indexer | Проверить CLI и SQLite adapters |
| Canonical session model | Session schema | Есть | Есть | Взять идею минимального adapter contract |
| Folder linkage | Обязательное `session.directory` | Зависит от источника | Legacy `task_metadata.json.cwd` | Использовать `directory` |
| Собственный индекс | Источник истины `kilo.db` | In-memory + SQLite cache | SQLite index | Не создавать Hub index в Step 1 |
| CLI | `kilo session list` | Нет | Собственный `cal` | Kilo CLI optional; `cal` не использовать |
| MCP/API | `kilo serve`, private VS Code backend | In-process REST/MCP | MCP + CLI | Не добавлять Hub API/MCP |
| Лицензия для прямого reuse | Не сторонний reuse | Commons Clause ограничивает использование | AGPL или commercial | Сторонний код не копировать без решения |

### 4.5 Project Manager for VS Code

Точная идентификация: [`alefragnani/vscode-project-manager`](https://github.com/alefragnani/vscode-project-manager), extension ID `alefragnani.project-manager`.

Полезно для Step 1:

- проверенный нативный `TreeDataProvider`/`TreeItem` pattern;
- refresh через `EventEmitter.fire()`;
- открытие через `vscode.openFolder` с явным `forceNewWindow`;
- разделение provider, nodes и commands.

Не подходит как источник списка:

- favorites являются ручным `projects.json`;
- autodetect сканирует configured folders;
- recent state является собственным списком расширения, а не VS Code `Open Recent`;
- public API присутствует в development branch, но ещё не был доступен в проверенной Marketplace release.

Лицензия — GPL-3.0 с exception для независимых расширений, взаимодействующих через exported API: [`LICENSE.md`](https://github.com/alefragnani/vscode-project-manager/blob/master/LICENSE.md). Для Step 1 не нужен ни source reuse, ни runtime API: стандартный VS Code API покрывает необходимые команды открытия.

### 4.6 Projects Dashboard - Sidebar

Точная Marketplace identity: [`TKTK.projects-dashboard-sidebar`](https://marketplace.visualstudio.com/items?itemName=TKTK.projects-dashboard-sidebar), version `0.8.1`. Указанный repository `TomasKliner/ProjectsDashboardNew` на дату проверки недоступен.

Расширение использует React `WebviewViewProvider`, собственный `projects-dashboard.json`, ручные projects/groups и собственный recent list. Этот recent list наблюдает открытые folders после активации расширения и не является полным VS Code `Open Recent`.

**Решение Step 1:** не использовать. UI тяжелее утверждённого native view, data model противоречит Kilo-only source, declared license GPL-3.0-only, а исходный repository недоступен для воспроизводимого review.

### 4.7 Chat Searcher

Точная идентификация: [`alexandergolbergwix/chat-searcher`](https://github.com/alexandergolbergwix/chat-searcher), Marketplace ID [`shvedbook.chat-searcher`](https://marketplace.visualstudio.com/items?itemName=shvedbook.chat-searcher).

Несмотря на широкое Marketplace-описание, checked source жёстко привязан к Cursor paths и Cursor SQLite schema. Kilo, Roo и Cline adapters отсутствуют. Проект извлекает полные сообщения, строит in-memory BM25 index и показывает webview panel.

**Решение Step 1:** не использовать parser, storage scanner или BM25. Проект решает другую задачу, читает message bodies, зависит от private Cursor schema и не поддерживает Kilo. Лицензия MIT не компенсирует техническое несоответствие.

### 4.8 Проверка ключевых утверждений исходного исследования

| Утверждение | Результат |
|---|---|
| Chat Wizard можно использовать как готовый Kilo history reader | Не подтверждено: Kilo source отсутствует |
| Callimachus поддерживает Kilo | Частично: есть legacy task-file reader, но не current `kilo.db` reader |
| Kilo имеет global local history | Подтверждено для Kilo `7.7.5` |
| Kilo имеет CLI list/search с JSON | Подтверждено: `kilo session list --all --format json` |
| Kilo VS Code extension экспортирует data API | Не подтверждено: exported API отсутствует |
| Project Manager может дать список Kilo-папок | Нет: его sources независимы от Kilo history |
| Projects Dashboard читает настоящий VS Code Open Recent | Нет: ведёт собственный observed recent list |
| VS Code предоставляет public read API для Open Recent | Нет |
| Chat Searcher поддерживает Kilo | Нет: checked implementation Cursor-specific |
| Для Step 1 нужен собственный index/search backend | Не подтверждено |

## 5. Предлагаемый Discovery spike

### Шаг 1. Зафиксировать среду

Записать:

- точную версию VS Code;
- точную версию и Extension ID Kilo;
- текущую local Kilo database/environment и действующие path overrides;
- Windows storage root;
- способ установки Kilo;
- наличие и версию Kilo CLI, если он установлен отдельно.

### Шаг 2. Подготовить контрольные данные

В отдельном тестовом профиле создать:

- два обычных диалога в одной локальной папке;
- один обычный диалог в другой папке;
- диалог с изменённым title;
- malformed fixture с пустым или отсутствующим title для defensive fallback;
- архивный и удалённый диалог;
- диалог для удалённой с диска папки;
- неподдерживаемую связь с `.code-workspace` или remote context, если это безопасно воспроизвести.

### Шаг 3. Проверить кандидатов источника

Для каждого API, CLI, IPC или storage-кандидата зафиксировать:

| Проверка | Ожидаемый результат |
|---|---|
| Список обычных диалогов | Получен без чтения message body |
| ID | Стабильный и уникальный |
| Title | Совпадает с UI Kilo |
| Timestamp | При наличии пригоден для сортировки; отсутствие включает fallback по имени |
| Folder linkage | Однозначно восстанавливает локальный путь |
| Archive/child state | Позволяет исключить архивные и дочерние sessions |
| Deleted session | После удаления строка отсутствует; отдельный флаг не ожидается |
| Read-only | Источник не изменяется |
| Concurrent access | Работает при запущенном Kilo и другом окне VS Code |
| Error isolation | Одна плохая запись не ломает весь результат |
| Version detection | Неизвестная схема определяется явно |
| Refresh | Повторное чтение видит новый или переименованный диалог |
| Empty title | Defensive fallback не ломает список |
| Duplicates | Одинаковый ID отображается один раз |
| Path normalization | Регистр и separators Windows не создают две папки |
| Unsupported paths | `.code-workspace`, UNC и non-local associations исключаются |
| Partial result | Повреждённая строка не скрывает корректные записи |
| Performance | 1 000 диалогов не блокируют Extension Host заметно |

### Шаг 4. Выбрать адаптер

Решение фиксируется короткой ADR-таблицей:

| Кандидат | Поля | Стабильность | Read-only | Риски | Решение |
|---|---|---|---|---|---|
| VS Code exported API | Данных нет | Не предоставляется | — | Отсутствует | Отклонён |
| Official CLI JSON | Все нужные metadata | Документирован | Да | CLI может быть не установлен | Проверить как optional source/oracle |
| `kilo serve` | Session API | Документирован | Только выбранные read endpoints | Отдельный процесс и auth | Не использовать в Step 1 по умолчанию |
| SQLite `kilo.db` | Все нужные metadata | Официальное storage, внутренняя versioned schema | При `mode=ro` | WAL, locking, schema changes, SQLite packaging | Основной кандидат для VSIX-only среды |

### Шаг 5. Проверить UI prototype

До завершения Discovery проверить на fixture-модели:

- 100 папок и 1 000 диалогов;
- длинные и не-ASCII названия и пути;
- collapsed row только с именем папки;
- раскрытые path, три action rows и conversation rows;
- `missing` visual state и блокировку трёх действий;
- keyboard navigation и native theme behavior.

### Шаг 6. Stop condition

Контрактный blocker снят: официальная schema содержит обязательный `session.directory`. Для выбранного VSIX-only/SQLite маршрута реализация остаётся заблокированной, пока local spike не подтвердит безопасное read-only чтение в Extension Host. Альтернатива с обязательным отдельным CLI требует отдельного продуктового решения. Нельзя молча заменять источник на `Open Recent`, сканирование диска или ручной реестр.

## 6. Предложения по архитектуре Step 1

### Рекомендация 1. Не расширять функциональный scope

Рыночные аналоги показывают ценность поиска и общей истории, но не делают эти функции необходимыми для проверки первого пользовательского сценария: увидеть папки с Kilo-активностью и открыть нужную. При этом границу данных «текущий профиль VS Code» нужно отдельно переутвердить: фактический источник является общей local Kilo database/environment.

### Рекомендация 2. Реализовывать UI только после source spike

Риск Step 1 находится не в `TreeDataProvider`, а в доступности и стабильности metadata Kilo. Сначала нужен работающий read-only extractor на реальных данных, затем UI.

### Рекомендация 3. Не создавать универсальный слой раньше времени

На Step 1 достаточно одного интерфейса `KiloConversationSource` и одной подтверждённой реализации. Не нужны provider registry, plugin system или поддержка нескольких агентов.

### Рекомендация 4. Начать с in-memory projection

Постоянный Hub index не нужен для текущего UI и создаёт вопросы синхронизации, миграции и удаления данных. По умолчанию следует начать с in-memory projection. Полностью восстанавливаемый технический cache остаётся допустимым, если измерения покажут проблему производительности или безопасного чтения.

### Рекомендация 5. Проверить Windows Explorer отдельно

Во время extension spike нужно подтвердить фактическое поведение выбранного официального API VS Code для папки, а не файла. Acceptance scenario должен проверять открытие самой папки в Проводнике Windows.

### Рекомендация 6. Для VSIX-only среды проверить SQLite первым

Пользователь не должен устанавливать отдельный CLI только ради Hub, если исходное условие поставки — VSIX рядом с Kilo extension. Поэтому основной spike должен проверить прямой read-only запрос только к таблице `session`. Официальный CLI следует использовать как oracle: результаты SQL adapter и `kilo session list --all --format json` на одной базе должны совпадать.

Отдельно нужно выбрать способ SQLite-доступа, совместимый с Extension Host и Windows packaging. Варианты сравниваются по ABI, размеру VSIX, поддержке x64/arm64, read-only/WAL semantics и минимальной версии VS Code. Решение не следует принимать только по удобству локальной разработки.

## 7. Что отложить и при каком сигнале вернуться

| Возможность | Когда возвращаться |
|---|---|
| Постоянный Hub Index | Когда появится поиск, несколько источников или измеренная проблема скорости |
| Full-text search | После накопления достаточного числа папок и подтверждения проблемы навигации |
| Summary | После решения вопроса приватности, стоимости и источника текста |
| Открытие конкретного диалога | После отдельного проектирования и появления стабильного поддерживаемого интерфейса |
| Hub API/MCP/tools | Когда появится второй реальный клиент данных Hub |
| Другие coding agents | После стабилизации модели Kilo и adapter contract |
| Remote, WSL, Dev Container, UNC | После отдельного проектирования URI и среды выполнения |
| Semantic search | Только если lexical search измеримо недостаточен |

## 8. Какие документы Step 1 могут измениться после spike

Результат исследования может уточнить, но не должен заранее расширять:

- `req/step1/02-discovery.md` — выбранный источник, команды, схема и ограничения;
- `req/step1/03-technical-plan.md` — конкретный adapter, зависимости и тестовые fixtures;
- `req/step1/04-preparation-and-acceptance.md` — версии Kilo/VS Code и воспроизводимые проверки;
- `req/step1/01-requirements.md` — только подтверждённые фактические поля и правила фильтрации.

Если runtime adapter не сможет безопасно прочитать подтверждённые metadata, это риск или блокер, а не автоматическое разрешение добавить `Open Recent`, ручной список, transcript indexing или собственную базу.

### Уже подтверждённые корректировки

До реализации рекомендуется отдельно согласовать и затем синхронно внести в документы Step 1:

1. Заменить «текущий профиль и текущая установка VS Code» на «текущая локальная Kilo database/environment».
2. Зафиксировать `session.directory` как связь с папкой, а `session.id` как ID диалога.
3. Подтвердить по Kilo History UI и затем определить обычный диалог как root session без `parent_id` и `time_archived`.
4. Уточнить, что удалённый диалог исчезает из источника и отдельного deleted-state не имеет.
5. Зафиксировать SQLite `kilo.db` как основной кандидат для VSIX-only среды и CLI JSON как optional source и проверочный oracle.
6. Убрать legacy `globalStorage/kilocode.kilo-code/tasks/*.json` из кандидатов актуального источника.
7. Для CLI spike добавить обнаружение усечения результатов: default global limit равен 100, а фиксированный произвольный limit не гарантирует полную историю.
8. Сохранить fallback `Без названия` только как defensive обработку повреждённой или несовместимой записи: в текущей schema title обязательный.
