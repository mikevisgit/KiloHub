# Матрица тестирования Step 1

## 1. Назначение

Этот документ задаёт трассировку требований Step 1 к четырём уровням проверки:

- `U-*` — unit tests без VS Code Extension Host;
- `I-*` — integration tests SQLite adapter и расширения в Extension Host;
- `P-*` — packaging tests production bundle и VSIX;
- `M-*` — ручные smoke tests установленного VSIX.

Матрица является планом проверок, а не отчётом о выполнении. Пройденным считается только тест с сохранённым фактическим результатом и указанным доказательством. Нормативные источники:

- `req/step1/01-requirements.md` — `FR-*`, нефункциональные требования и границы scope;
- `req/step1/02-discovery.md` — контракт discovery, SQLite и CLI oracle;
- `req/step1/03-technical-plan.md` — архитектура, команды и уровни тестов;
- `req/step1/04-preparation-and-acceptance.md` — `AC-*` и Definition of Done;
- `specs/step1-implementation-plan.md` — gates `D1-D4`, этапы `I1-I4` и проверки `V1-V4`.

## 2. Правила доказательства

| Уровень | Среда | Что считается доказательством |
|---|---|---|
| Unit | Обезличенные объекты и fixtures в `tests/` | Имя теста, ожидаемое и фактическое значение, успешный test report |
| Integration | Временная копия SQLite fixture; для UI — поддерживаемый VS Code Extension Host | Test report, логи Output Channel без пользовательского содержимого, fingerprints тестовых файлов при проверке read-only |
| Packaging | Чистая установка зависимостей и production-сборка | Успешные команды, список файлов VSIX, проверка runtime-зависимостей, имя и SHA-256 пакета |
| Manual smoke | Отдельный VS Code profile, отдельный каталог extensions и изолированная Kilo environment | Версии среды, пошаговый протокол, ожидаемый и фактический результат, обезличенные снимки UI при необходимости |

Общие правила:

1. Рабочая пользовательская `kilo.db` не используется для destructive setup и никогда не изменяется тестом.
2. Тесты записи работают только с временными fixtures. Production adapter открывает источник строго read-only.
3. Fixtures содержат только metadata sessions. Тела сообщений и содержимое проектов отсутствуют.
4. Для каждого провала сохраняются команда, версия среды и минимальная обезличенная диагностика.
5. Ручная проверка не заменяет автоматическую там, где поведение можно детерминированно проверить автоматически.
6. `CLI oracle` применяется только в discovery к изолированной базе с менее чем 10 000 подходящих sessions и с фиксированным `--max-count 10000`. CLI не входит в runtime или VSIX.

## 3. Наборы тестовых данных

| Fixture | Состав | Назначение |
|---|---|---|
| `F-BASE` | Несколько root/non-archived sessions в двух локальных папках; известные timestamps | Базовая projection, группировка и сортировка |
| `F-FILTER` | Root, child, archived, запись без directory, `.code-workspace`, remote URI, UNC | Фильтрация поддерживаемых sessions и путей |
| `F-PATHS` | Эквивалентные варианты регистра, `/` и `\`, trailing separator, `file:///`, пробелы и не-ASCII; также некорректные и неоднозначные значения | Нормализация и path edge cases |
| `F-TITLES` | Одинаковые titles у разных ID, пустой/whitespace title, длинный и не-ASCII title | Title, fallback и отсутствие ложной дедупликации |
| `F-DUPLICATES` | Повтор одного `session.id`, в том числе конфликтующие копии | Дедупликация и детерминированная обработка повреждения |
| `F-SCHEMA-775` | Минимальная подтверждённая совместимая schema Kilo 7.7.5 | Положительный schema guard |
| `F-SCHEMA-NEW` | Более новая metadata version с обязательными совместимыми полями и дополнительным полем | Forward compatibility в пределах schema guard |
| `F-SCHEMA-BAD-*` | Нет таблицы/обязательного столбца, несовместимый тип или семантика, версия ниже 7.7.5, повреждённая DB | Отрицательный schema guard и диагностика |
| `F-WAL` | DB в WAL mode с `-wal` и `-shm`, контролируемая writer connection | Видимость committed WAL transaction и отсутствие записи reader |
| `F-REFRESH` | Последовательные snapshots: create, rename, delete, delete-last, source error | Полная атомарная перестройка модели |
| `F-1000` | Не менее 1 000 sessions, включая 100 папок, duplicates и отфильтровываемые строки | Производительность и полнота результата |
| `F-CLI` | Изолированная база с менее чем 10 000 подходящих sessions и обезличенный результат официального CLI | Сверка `id`, `title`, `directory`, root/archive filter |

Точное имя timestamp-столбца, единица времени, metadata version и правило выбора конфликтующего duplicate должны быть заполнены после gates `D1-D2`. До этого соответствующие тесты считаются специфицированными, но заблокированными, а не пройденными.

## 4. Unit tests

| ID | Проверка | Вход | Ожидаемый результат | Трассировка |
|---|---|---|---|---|
| U-001 | Root/non-archived filter | Root, child и archived rows | Остаются только строки `parent_id IS NULL AND time_archived IS NULL` | FR-1, AC-13, D2, I2 |
| U-002 | Валидная metadata projection | `id`, `title`, `directory`, подтверждённый timestamp | Создан `KiloConversation` без чтения дополнительных полей | FR-1, D2 |
| U-003 | Пустой title | `null`, `""` и whitespace-only title | Диалог сохранён как `Без названия`; сформировано одно диагностическое предупреждение без message body | FR-4, AC-14 |
| U-004 | Одинаковые titles | Разные ID с одинаковым title | Оба диалога сохранены | §4 модели данных, AC-4 |
| U-005 | Дубликат ID | Повтор одного `session.id` | В результате один диалог; выбор записи детерминирован и диагностирован при конфликте | FR-2, D4, I3 |
| U-006 | Повреждённая строка | Некорректный ID, directory или timestamp рядом с корректной строкой | Некорректная строка пропущена или timestamp трактуется как отсутствующий по подтверждённому контракту; корректная строка остаётся | NFR «повреждённая запись», D4 |
| U-007 | Обычный Windows path | `D:\Projects\Alpha` | Принят абсолютный локальный путь и создан `file` URI | FR-2, D4 |
| U-008 | Регистр и separators | `D:\Projects\Alpha`, `d:/projects/alpha/` | Один case-insensitive folder identity; отображаемый canonical path детерминирован | AC-5, edge case path |
| U-009 | Локальный file URI | `file:///D:/Projects/Alpha` | Нормализован к той же folder identity, что и локальный path | FR-2, D4 |
| U-010 | Пробелы и не-ASCII | Path/file URI с пробелами, percent-encoding и Unicode | Корректно декодирован один локальный путь; label и title не повреждены | Edge cases, manual scope |
| U-011 | Trailing separator и drive root | Варианты с завершающим separator; `D:\` | Separator не создаёт duplicate; корень диска остаётся валидным локальным folder URI | D4 |
| U-012 | UNC | `\\server\share\project`, `//server/share/project`, `file://server/share/project` | Запись исключена и диагностирована без падения | FR-2, AC-13 |
| U-013 | Remote contexts | `vscode-remote://`, `ssh://`, WSL и Dev Container URI | Все записи исключены | FR-2, AC-13 |
| U-014 | `.code-workspace` | Path/URI с расширением в любом регистре | Запись исключена, folder не создаётся | FR-2, AC-13 |
| U-015 | Неоднозначный или некорректный path | Пустое, относительное, malformed URI, NUL, неизвестная схема, multi-root representation | Запись исключена и диагностирована; исключение наружу не выходит | Правило включения, D4 |
| U-016 | Запись без directory | `null`, пустое или whitespace-only значение | Запись исключена | Правило включения, edge case |
| U-017 | Группировка | Несколько sessions одной canonical folder identity | Одна `KiloFolder` со всеми уникальными диалогами | FR-2, AC-5 |
| U-018 | Пустая группа | Все строки группы отфильтрованы | Папка отсутствует в результате | FR-3, AC-3 |
| U-019 | Missing state | Проверка существования возвращает `false` или access error | Folder остаётся с `available: false`; conversations сохранены; ошибка одной папки не ломает остальные | FR-9, AC-9 |
| U-020 | Сортировка диалогов | Известные разные/равные timestamps и отсутствующий timestamp | Известные даты идут первыми по убыванию; при равенстве — case-insensitive title и затем ID; без даты — title и затем ID | FR-5, AC-14, D4 |
| U-021 | Сортировка папок | Разные/равные `lastKiloActivityAt`, папки без дат | Сначала известная максимальная активность по убыванию; tie-breaker — case-insensitive name и canonical path; без даты — name и canonical path | FR-5, AC-14, D4 |
| U-022 | Последняя активность папки | Несколько диалогов с датой и без даты | `lastKiloActivityAt` равна максимальной достоверной дате | Модель данных, FR-5 |
| U-023 | Folder label | Path с завершающим separator и не-ASCII | Label вычислен из имени папки, не из title | UI §5.2, D4 |
| U-024 | Упорядочение дочерних UI nodes | Folder model | Ровно: полный path, `Open Here`, `Open in New Window`, `Open in File Explorer`, затем отсортированные conversations | UI §5.3, AC-4 |
| U-025 | Folder tree item | Available и missing folder | Label содержит только имя; description отсутствует; tooltip содержит path, count и дату при наличии; missing имеет отдельный visual state | UI §5.2, AC-9 |
| U-026 | Conversation tree item | Title с датой и без даты | Label равен title; достоверная дата показана как description; item не имеет команды перехода | UI §5.4 |
| U-027 | Параметры `Open Here` | Available folder URI | Подготовлен вызов `vscode.openFolder(uri, { forceReuseWindow: true })` | FR-7, AC-7 |
| U-028 | Параметры `Open in New Window` | Available folder URI | Подготовлен вызов `vscode.openFolder(uri, { forceNewWindow: true })` | FR-8, AC-8 |
| U-029 | Параметры Проводника | Available folder URI | Подготовлен вызов стандартного API VS Code для открытия folder URI | FR-10, AC-12 |
| U-030 | Блокировка команд missing folder | `available: false` для каждой из трёх команд | VS Code API открытия не вызывается; сформировано понятное сообщение | FR-9, FR-10, AC-9 |
| U-031 | Ошибка availability одной папки | Проверка одного path бросает исключение | Эта папка становится missing; остальные обработаны | I3, NFR повреждения |
| U-032 | Metadata-only logging | Ошибки rows/path/title | Диагностика содержит ID/тип ошибки в минимальном объёме и не содержит message body или содержимого проекта | FR-1, privacy NFR |

## 5. Integration tests

### 5.1 SQLite adapter

| ID | Проверка | Метод | Ожидаемый результат | Трассировка |
|---|---|---|---|---|
| I-001 | Приоритет расположения DB | Временные пути для `KILO_DB`, `XDG_DATA_HOME`, channel/environment и default path | Выбран ровно один путь по документированному после D1 приоритету; неоднозначность и отсутствие дают понятную ошибку | D1, I2, AC-15 |
| I-002 | Только Windows | Запуск platform guard для Windows и не-Windows | Windows допускается; другая платформа отклоняется до SQLite open с понятной ошибкой | NFR Windows-only |
| I-003 | Положительный schema guard 7.7.5 | `F-SCHEMA-775` | Guard выполняется до metadata query и принимает подтверждённую schema | D2, DoD |
| I-004 | Совместимая более новая schema | `F-SCHEMA-NEW` | Дополнительные столбцы не мешают; обязательные поля и семантика проверены | NFR schema compatibility |
| I-005 | Версия ниже 7.7.5 | Соответствующая metadata fixture | Чтение отклонено с понятной пользовательской ошибкой и технической записью в Output | Discovery §5, DoD |
| I-006 | Несовместимая schema | По одному fixture без таблицы и каждого обязательного столбца, с несовместимым типом/семантикой | Чтение не начинается частично; названа причина несовместимости; DB не изменена | D2, AC-15 |
| I-007 | Повреждённая DB | Malformed SQLite fixture | Нет падения Extension Host; connection/resources освобождены; доступен повторный `Refresh` | V2, AC-15 |
| I-008 | Metadata-only SQL | Инструментировать подготовленные statements/SQLite authorizer | Обращение только к разрешённой schema metadata и нужным столбцам `session`; таблицы сообщений не читаются; write opcodes запрещены | FR-1, D2, privacy NFR |
| I-009 | Read-only open | Открыть fixture через production adapter; попытка write через ту же connection в тестовом probe | Режим connection read-only; write отклонён SQLite; adapter не выполняет migration/PRAGMA с записью | FR-1, AC-10, V2 |
| I-010 | Неизменность DB без writer | Зафиксировать размер и SHA-256 DB/WAL/SHM и список файлов каталога до и после load/refresh/deactivate | DB/WAL/SHM побайтово неизменны; новые journal/sidecar/temp files не созданы | AC-10, V2 |
| I-011 | Read-only каталог | Скопировать полный WAL fixture в каталог без права записи и открыть production adapter | Чтение успешно, если runtime-контракт допускает существующие sidecars; никакой файл не создаётся. Иначе runtime отклоняется на D3 | D3, read-only NFR |
| I-012 | Видимость committed WAL | Writer создаёт подтверждённую transaction только в WAL и остаётся открытым; затем reader выполняет refresh | Новая session видна целиком; нет partial result или `SQLITE_BUSY` при штатном режиме | D3, V2, WAL NFR |
| I-013 | Атрибуция изменений WAL | После writer commit приостановить writer, снять fingerprints DB/WAL/SHM и список файлов, выполнить только Hub read, снять повторно | Hub не меняет содержимое DB/WAL/SHM и не создаёт файлы; изменения отдельного writer не считаются изменениями Hub | AC-10, V2 |
| I-014 | Concurrent commit во время чтения | Координировать длинное чтение и вторую writer transaction | Reader возвращает один согласованный snapshot; следующий refresh видит committed изменение | Discovery concurrency, FR-6 |
| I-015 | Busy/locked | Удерживать блокировку, вызывающую подтверждённый для runtime busy path | Ограниченное ожидание/ошибка без зависания; connection закрыта; понятная ошибка и возможность retry | D3, V2, AC-15 |
| I-016 | Освобождение ресурсов | Success, schema error, malformed row, busy, refresh и deactivate | Все statements/connections закрыты; fixture можно переместить/удалить на Windows после завершения | I2, D3 |
| I-017 | Частично повреждённые rows | Корректные и повреждённые строки в одной совместимой DB | Корректные строки показаны, повреждённые пропущены или получают допустимый fallback; предупреждения записаны | NFR damaged row |
| I-018 | CLI oracle | Сравнить adapter с `kilo session list --all --max-count 10000 --format json` на `F-CLI` | Совпадают `id`, `title`, `directory` и root/non-archived состав после документированной normalization; расхождение блокирует приёмку | Discovery §5, DoD |
| I-019 | 1 000 sessions | Загрузить `F-1000` production adapter и projection; измерить wall time и event-loop delay по заранее зафиксированному бюджету D3 | Все ожидаемые sessions обработаны; Extension Host не имеет заметной блокировки; метрики и машина записаны | NFR performance, V1 |

Для `I-010` и `I-013` fingerprints снимаются только в стабильных контрольных точках. Активный writer должен быть приостановлен барьером; иначе изменение WAL нельзя достоверно приписать reader или writer. Проверка файлов дополняет, но не заменяет явный SQLite read-only mode и запрет write statements.

### 5.2 Extension Host и UI contract

| ID | Проверка | Метод | Ожидаемый результат | Трассировка |
|---|---|---|---|---|
| I-020 | Регистрация UI | Активировать extension в test host | Зарегистрированы контейнер `Kilo Hub`, view `Kilo Folders` и только четыре команды Step 1 | AC-1, I1, I4 |
| I-021 | Lazy first load | Создать extension, не раскрывая view, затем впервые открыть view | До первого показа источник не читается; при первом показе выполняется одно чтение и появляется модель | FR-6, I4 |
| I-022 | Верхний уровень | Adapter возвращает две папки | Верхний уровень — плоский список; каждый item показывает только имя, без path description | UI §5.1-5.2, DoD |
| I-023 | Порядок раскрытой папки | Раскрыть folder с тремя conversations | Полный path, три action nodes в нормативном порядке, затем три conversation nodes | AC-4, UI §5.3 |
| I-024 | Conversation passive | Выполнить click/selection conversation node | Конкретный Kilo-диалог не открывается; command отсутствует | UI §5.4, excluded scope |
| I-025 | Успешный refresh | Adapter snapshot меняется create → rename → delete → delete-last | Модель атомарно заменяется; новая session появляется, title меняется, удалённая session и пустая folder исчезают без host restart | FR-6, AC-6 |
| I-026 | Ошибка refresh после успеха | Сначала корректная модель, затем adapter error | Последняя корректная in-memory модель сохранена; показана понятная ошибка; Output содержит детали; следующий refresh доступен | План §5, AC-15 |
| I-027 | Ошибка первого чтения и recovery | Первый load падает, второй refresh успешен | View показывает error/empty state без ложных данных; ручной retry заменяет его корректной моделью | AC-15 |
| I-028 | Folder без conversations | Adapter возвращает пустую группу или только отфильтрованные sessions | Item папки отсутствует | FR-3, AC-3 |
| I-029 | Missing folder UI | Adapter возвращает missing folder с conversations | Folder и titles видны, visual state отличается; три команды не вызывают API открытия | FR-9, AC-9 |
| I-030 | `Open Here` command | Подменить `vscode.commands.executeCommand` | Единственный вызов `vscode.openFolder` с URI и `{ forceReuseWindow: true }` | FR-7, AC-7 |
| I-031 | `Open in New Window` command | Подменить `vscode.commands.executeCommand` | Единственный вызов `vscode.openFolder` с URI и `{ forceNewWindow: true }` | FR-8, AC-8 |
| I-032 | `Open in File Explorer` command | Подменить стандартный VS Code API | Вызван API с folder URI; shell-команда и ручная конкатенация аргументов не используются | FR-10, AC-12 |
| I-033 | Output Channel | Вызвать fallback title, invalid row, schema и read errors | Канал называется `Kilo Hub`; есть техническая причина без message body, secrets и содержимого файлов | FR-4, AC-14, AC-15 |
| I-034 | Deactivate | Активировать, загрузить данные, деактивировать | Provider/commands/output/SQLite resources освобождены без записи состояния в Kilo | I2, I4 |

## 6. Packaging tests

| ID | Проверка | Метод | Ожидаемый результат | Трассировка |
|---|---|---|---|---|
| P-001 | Чистый pipeline | Выполнить `npm ci`, typecheck/build, lint и все automated tests | Все команды завершаются с code 0 на зафиксированной Node.js/VS Code версии | V1, DoD |
| P-002 | Воспроизводимая package command | Дважды выполнить `npm run package` из чистого состояния | Каждый запуск создаёт версионированный `dist/kilo-hub-<version>.vsix`; состав файлов совпадает, допустимые различия архива задокументированы | V4, DoD |
| P-003 | Manifest scope | Проверить распакованный `package.json` | Объявлены Windows-compatible engine, Activity Bar container, `Kilo Folders`, `kiloHub.refresh`, `kiloHub.openHere`, `kiloHub.openNewWindow`, `kiloHub.openInFileExplorer`; лишних feature-команд нет | I1, AC-1, AC-11 |
| P-004 | Production allow-list | Получить полный список архива VSIX | Включены только production bundle, manifest, license/notice, icon и нужные runtime assets; нет `tests/`, fixtures, `req/`, `specs/`, `reviews/`, исходных DB и лишних source maps | I1, V4, quality criteria |
| P-005 | SQLite runtime внутри VSIX | Установить/загрузить именно распакованный пакет, не workspace build | Все JS/WASM/native runtime-файлы присутствуют; модуль загружается в целевом Windows Extension Host без ABI/module-not-found errors | D3, V4, DoD |
| P-006 | Runtime read-only/WAL после упаковки | Прогнать `I-009`–`I-016` через entrypoint распакованного production bundle | Поведение совпадает с integration build: read-only, WAL-visible, resources closed | D3, V2, V4 |
| P-007 | Нет CLI runtime dependency | Проверить dependency tree, bundle и запуск с отсутствующим Kilo CLI в `PATH` | Hub читает fixture и строит UI; CLI executable/package не включён и не вызывается | FR-1, AC-1, DoD |
| P-008 | Нет запрещённых data/runtime dependencies | Проверить bundle, manifest и network instrumentation при activation/refresh | Нет Hub database, telemetry, LLM, HTTP backend, message reader и project file indexer | NFR, excluded scope |
| P-009 | Лицензии production dependencies | Сопоставить lockfile, bundled dependencies, license/notice | Все реально упакованные зависимости учтены; запрещённых или неизвестных лицензий нет | V3-V4 |
| P-010 | Установка пакета | Установить VSIX в чистые profile и extensions dir целевой версии VS Code | Установка и activation успешны; extension доступен только из установленного пакета | AC-1, V4 |
| P-011 | Артефакт | Вычислить SHA-256 и размер итогового файла | Имя, абсолютный путь, версия, размер и checksum записаны в release evidence/handoff | V4, quality criteria |

## 7. Ручные smoke tests

### 7.1 Предусловия

- Windows и поддерживаемая версия VS Code, определённая после SQLite packaging spike.
- Kilo Code 7.7.5 или подтверждённая более новая совместимая версия.
- Отдельные `--user-data-dir` и `--extensions-dir`.
- Установлен именно итоговый VSIX.
- Изолированная Kilo database/environment выбрана подтверждённым override.
- Подготовлены: две папки с sessions, контрольная папка без session, child, archived, session для удаления, missing folder, путь с пробелами и не-ASCII.
- До запуска сняты fingerprints DB/WAL/SHM и список файлов каталога источника.

### 7.2 Сценарии

| ID | Действие | Ожидаемый результат | Доказательство | Трассировка |
|---|---|---|---|---|
| M-001 | Запустить установленный VSIX без сети и без Kilo CLI в `PATH` | В Activity Bar есть Kilo Hub; activation без ошибок; CLI и сеть не требуются | Версии, activation log, снимок Activity Bar | AC-1, FR-1 |
| M-002 | Впервые открыть `Kilo Folders` | Выполняется lazy load; видны только папки с обычными Kilo sessions | Снимок верхнего уровня и контрольный список | AC-2, AC-3 |
| M-003 | Проверить верхний уровень | Список плоский; в свёрнутом виде у folder только имя, без полного path | Снимок UI | UI §5.2, DoD |
| M-004 | Раскрыть folder с несколькими sessions | Сверху полный path, затем `Open Here`, `Open in New Window`, `Open in File Explorer`, затем все titles в требуемой сортировке | Снимок раскрытой folder | AC-4, AC-14 |
| M-005 | Проверить одинаковые titles, длинный и не-ASCII title | Разные ID видны отдельными строками; текст не повреждён; tooltip доступен | Снимок/протокол | Title edge cases |
| M-006 | Проверить пустой title fixture | Показано `Без названия`; в Output `Kilo Hub` есть предупреждение без тела сообщения | Снимок UI и обезличенная строка Output | AC-14 |
| M-007 | Проверить эквивалентные варианты Windows path | Варианты регистра/separator/file URI представлены одной folder со всеми dialogs | Контрольный expected list | AC-5 |
| M-008 | Проверить неподдерживаемые записи | Child, archived, `.code-workspace`, remote/WSL/Dev Container и UNC не создают folders/conversations | Контрольный expected list | AC-13 |
| M-009 | Создать новую root session и вызвать `Refresh` | Новая session появляется без restart | До/после UI | AC-6 |
| M-010 | Переименовать session и вызвать `Refresh` | Title изменяется, duplicate folder не появляется | До/после UI | AC-6 |
| M-011 | Удалить session и вызвать `Refresh`; затем удалить последнюю session folder | Сначала исчезает dialog, затем опустевшая folder | До/после UI | AC-6 |
| M-012 | Вызвать refresh при временно недоступном источнике, затем восстановить его и повторить | Показана понятная ошибка; последняя корректная модель не потеряна; детали в Output; повтор успешен | UI и Output log | AC-15 |
| M-013 | Удалить тестовую папку, оставив Kilo history, и вызвать `Refresh` | Folder остаётся как missing, titles доступны, все открытия заблокированы без падения | Снимок и уведомления | AC-9 |
| M-014 | На available folder вызвать `Open Here` | Текущее окно штатно переключается на выбранную folder; завершение старого Extension Host не считается ошибкой | Новый workspace path | AC-7 |
| M-015 | На available folder вызвать `Open in New Window` | Исходное окно остаётся, новое открыто на выбранной folder | Paths двух окон | AC-8 |
| M-016 | На available folder вызвать `Open in File Explorer` | Windows Explorer открывает выбранную folder | Фактический Explorer path | AC-12 |
| M-017 | Держать Kilo открытым, выполнить create/rename и Hub refresh | Hub читает согласованные committed данные без повреждения и заметного влияния на Kilo | Протокол операций и Output | WAL/concurrency NFR |
| M-018 | Открыть fixture с 100 папками и 1 000 sessions, раскрыть несколько folders и вызвать refresh | UI остаётся отзывчивым, список полон и сортировка стабильна; фактические метрики сопоставлены с бюджетом `I-019` | Метрики и контрольные counts | Performance NFR |
| M-019 | После всех read/refresh операций повторно снять fingerprints | При отсутствии тестового writer DB/WAL/SHM и список файлов не изменились Hub; при writer-сценарии изменения соответствуют только заранее записанным операциям writer | SHA-256, размеры, file list, журнал writer | AC-10 |
| M-020 | Осмотреть toolbar, folder items, context menus и Command Palette | Есть только `Refresh` и три нормативных folder actions в предусмотренных местах; нет inline/context действий folder, add/remove/hide/import/copy | Снимки/перечень команд | AC-11, UI §5.3 |
| M-021 | Выбрать conversation node | Никакой dialog, webview или файл не открывается | Протокол | Excluded «открытие диалога» |

## 8. Проверка исключённых функций

| ID | Исключённая функция | Автоматическая проверка | Ручная проверка | Критерий прохождения | Источник |
|---|---|---|---|---|---|
| X-001 | Add/remove/hide folder и ручной реестр | `P-003`, `P-008`; нет command IDs, storage writes и Hub DB | `M-020` | Состав списка определяется только Kilo source | AC-11, FR-11 |
| X-002 | Импорт VS Code `Open Recent` | Нет вызова recent API/command и соответствующей команды | Контрольная opened folder без session отсутствует в `M-002` | Open Recent не влияет на список | AC-3 |
| X-003 | Summary, LLM, embeddings | Нет model/network dependencies и команд | В UI только сохранённый title | Нет генерации или model calls | AC-4, DoD |
| X-004 | Поиск по телам сообщений | `I-008` запрещает message tables; `P-008` проверяет bundle | В UI нет search | Ни одно тело сообщения не читается | FR-1, DoD |
| X-005 | Чтение/индекс файлов проекта | Нет filesystem traversal/indexer; только точечная availability check folder path | Нет соответствующего UI | Содержимое проектов не читается | Privacy NFR |
| X-006 | Открытие конкретного Kilo-диалога | `I-024`: у conversation item нет command | `M-021` | Conversation только отображается | UI §5.4 |
| X-007 | Автоматический watcher | Нет watcher/timer/subscription к storage | Изменения не видны до `Refresh`, затем видны | Обновление только lazy load/ручное | FR-6 |
| X-008 | Legacy task JSON | Нет reader/path fallback для `globalStorage/kilocode.kilo-code/tasks/*.json` | Запуск без legacy данных успешен | Единственный источник — `kilo.db` | NFR legacy exclusion |
| X-009 | `.code-workspace`, multi-root, remote и UNC | `U-012`–`U-015`, `I-017` | `M-008` | Записи исключены | AC-13 |
| X-010 | Telemetry, cloud sync, Hub API/MCP/backend | Dependency/bundle/network inspection `P-008` | Offline `M-001` | Нет endpoints и исходящего runtime traffic | NFR и excluded scope |
| X-011 | Постоянный технический cache | Проверить отсутствие cache writes в extension storage | Перезапуск строит список из Kilo source | На Step 1 используется только in-memory model | Рекомендуемая конфигурация §6 |

## 9. Трассировка acceptance scenarios

| Acceptance | Unit | Integration | Packaging | Manual smoke |
|---|---|---|---|---|
| AC-1 Установка | — | I-020 | P-003, P-005, P-007, P-010 | M-001 |
| AC-2 Папка с Kilo-активностью | U-001, U-007, U-017 | I-017, I-022 | P-006 | M-002 |
| AC-3 Папка без Kilo-активности | U-018 | I-028 | — | M-002 |
| AC-4 Названия и детали | U-002–U-004, U-024–U-026 | I-023, I-024 | P-003 | M-004–M-006 |
| AC-5 Группировка | U-005, U-008–U-011, U-017 | I-019 | — | M-007 |
| AC-6 Refresh | — | I-021, I-025–I-027 | P-006 | M-009–M-012 |
| AC-7 Open Here | U-027, U-030 | I-030 | P-003 | M-014 |
| AC-8 Open in New Window | U-028, U-030 | I-031 | P-003 | M-015 |
| AC-9 Missing folder | U-019, U-025, U-030 | I-029 | — | M-013 |
| AC-10 Read-only | U-032 | I-008–I-016 | P-006 | M-017, M-019 |
| AC-11 Нет ручного реестра | — | I-020, I-025 | P-003, P-008 | M-020 |
| AC-12 Проводник | U-029, U-030 | I-032 | P-003 | M-016 |
| AC-13 Фильтрация | U-001, U-012–U-016 | I-017 | — | M-008 |
| AC-14 Fallback и сортировка | U-003, U-020–U-022 | I-033 | — | M-004, M-006 |
| AC-15 Ошибка чтения | — | I-001, I-005–I-007, I-015, I-026–I-027, I-033 | P-006 | M-012 |

## 10. Трассировка функциональных и качественных требований

| Требование | Основные тесты |
|---|---|
| FR-1 metadata-only, root/non-archived, без CLI runtime | U-001–U-006, I-003–I-009, I-017–I-018, P-007 |
| FR-2 нормализация и группировка | U-007–U-017, M-007–M-008 |
| FR-3 только непустые группы | U-018, I-028, M-002 |
| FR-4 title и `Без названия` | U-003–U-004, I-033, M-005–M-006 |
| FR-5 сортировка | U-020–U-022, M-004, M-018 |
| FR-6 lazy load и ручной refresh | I-021, I-025–I-027, M-009–M-012 |
| FR-7 Open Here | U-027, I-030, M-014 |
| FR-8 Open in New Window | U-028, I-031, M-015 |
| FR-9 missing path | U-019, U-025, U-030, I-029, M-013 |
| FR-10 Проводник | U-029–U-030, I-032, M-016 |
| FR-11 отсутствие реестра | I-025, P-008, X-001, X-011 |
| Read-only, WAL/SHM, concurrency, busy | I-009–I-016, P-006, M-017, M-019 |
| Schema guard и Kilo 7.7.5+ | I-003–I-007, P-006 |
| Ошибка строки не ломает список | U-003, U-006, U-031, I-017 |
| 1 000 sessions без заметной блокировки | I-019, M-018 |
| Без сети, telemetry, LLM и project content | U-032, I-008, P-007–P-008, X-003–X-005, X-010 |
| Windows-only и path edge cases | U-007–U-016, I-002, M-005, M-007–M-008 |
| Production bundle и устанавливаемый VSIX | P-001–P-011, M-001 |

## 11. Порог готовности

Step 1 не принимается, пока одновременно не выполнены условия:

1. Все `U-*`, `I-*` и `P-*` либо прошли, либо имеют явно согласованное неприменимое основание; blocking/high failures отсутствуют.
2. Все `AC-1`–`AC-15` имеют как минимум одно автоматическое и одно фактическое acceptance-доказательство там, где в таблице предусмотрен manual smoke.
3. `I-009`–`I-016`, `P-006` и `M-019` доказали read-only/WAL поведение именно production runtime.
4. Schema guard принимает Kilo 7.7.5 fixture и совместимую новую schema, но отклоняет каждый вариант `F-SCHEMA-BAD-*` до основного запроса.
5. `I-019` и `M-018` прошли по численно зафиксированному до измерения бюджету времени/event-loop delay; формулировка «визуально быстро» сама по себе недостаточна.
6. Проверен распакованный состав VSIX, а smoke выполнялся из установленного пакета в изолированном profile, не из workspace build.
7. Зафиксированы точный путь к VSIX, версия, размер, SHA-256, версии VS Code/Kilo/Node.js и команды проверки.
8. Ни один тест не использовал тела сообщений, содержимое пользовательских проектов или изменяемый доступ к рабочей `kilo.db`.
