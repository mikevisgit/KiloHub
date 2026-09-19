# План реализации Step 1

## Цель

Создать версионированный Windows VSIX, который выполняет все критерии приёмки из `req/step1/04-preparation-and-acceptance.md` и не добавляет исключённые функции.

## Структура репозитория

```text
src/       production-код TypeScript
tests/     unit/integration tests и обезличенные fixtures
docs/      discovery, verification, release и эксплуатационная документация
specs/     планы и контракты реализации
reviews/   отчёты независимых ревью и результаты исправлений
build/     сгенерированный JavaScript и промежуточные результаты
resources/ статические ресурсы расширения для упаковки
dist/      только итоговые версионированные VSIX
```

Существующие документы в `req/` и `discovery/` остаются исходными материалами и во время реализации не перемещаются.

## Неизменяемые правила

- Открывать Kilo SQLite с неизменяемым намерением приложения: read-only, без миграций, создающих записи pragma и создания файлов.
- Запрашивать только metadata session: ID, title, directory, признаки parent/archive и timestamps.
- Никогда не запрашивать сообщения и содержимое файлов проектов.
- Включать только root sessions без архива с поддерживаемыми локальными путями Windows.
- Исключать UNC, remote URI, `.code-workspace`, неоднозначные и некорректные пути.
- При ошибке refresh сохранять последнюю корректную in-memory модель.
- Не требовать отдельный Kilo CLI во время работы расширения.
- Не добавлять реестр Hub, summary, поиск, LLM, telemetry и автоматический watcher.

## Этап D: Discovery gates

### D1. Среда и расположение storage

- [x] Найти активную `kilo.db` Kilo 7.7.5, не изменяя её.
- [x] По первичным доказательствам описать стандартный путь Windows и поддерживаемые overrides `KILO_DB`/`XDG_DATA_HOME`/channel.
- [x] Задать однозначный приоритет путей и ошибки отсутствующего или недоступного источника.

Доказательство: `docs/kilo-storage-discovery.md`.

### D2. Контракт schema

- [x] Записать столбцы и типы таблицы `session`, а также относящиеся к ней metadata версии.
- [x] Подтвердить timestamps и единицы измерения.
- [x] Определить schema guard по обязательным столбцам и совместимой семантике.
- [x] Подтвердить точный metadata-only запрос root/non-archived sessions.

Доказательство: обезличенная schema fixture и `docs/kilo-storage-discovery.md`.

### D3. Проверка SQLite runtime

- [x] Выбрать runtime, совместимый с поддерживаемым Extension Host VS Code: кандидат `node:sqlite` и VS Code `1.105.1`.
- [ ] Доказать read-only открытие, видимость WAL, busy handling и освобождение connection.
- [ ] Доказать работоспособность runtime после production bundling и упаковки VSIX.
- [ ] Зафиксировать минимальную версию VS Code по результатам выбора runtime.

Доказательство: автоматические тесты и `docs/sqlite-runtime-decision.md`.

### D4. Правила projection

- [ ] Определить нормализацию Windows path/file URI.
- [ ] Определить дедупликацию, fallback title, сортировку timestamps и состояние missing folder.
- [ ] Сопоставить обработку повреждённых записей и диагностику.

Доказательство: матрица в `specs/step1-test-matrix.md`.

## Этап I: Реализация

### I1. Каркас расширения

- [ ] Добавить manifest, конфигурацию TypeScript/build/lint/test/package, иконку и license metadata. Файлы созданы, verification ожидает production entrypoint.
- [ ] Объявить только view и команды Step 1. Contributions добавлены, manifest test ещё не выполнен.
- [ ] Сделать allow-list упаковки минимальным. Allow-list и ZIP verifier добавлены, package ещё не собран.

### I2. Data adapter

- [ ] Определять путь к базе данных.
- [ ] Проверять платформу, доступность базы для чтения и schema.
- [ ] Читать metadata session через read-only connection.
- [ ] Изолировать повреждения отдельных строк и записывать диагностические предупреждения.
- [ ] Закрывать ресурсы при успехе, ошибке, refresh и деактивации расширения.

### I3. Domain projection

- [ ] Нормализовать и фильтровать поддерживаемые пути.
- [ ] Удалять дубликаты conversations по ID session.
- [ ] Группировать по case-insensitive идентичности Windows folder.
- [ ] Определять доступность без падения всего refresh.
- [ ] Детерминированно сортировать conversations и folders.

### I4. Нативный UI и команды

- [ ] Зарегистрировать контейнер Activity Bar и дерево `Kilo Folders`.
- [ ] Выполнять lazy-load при первом показе view и повторное чтение по `Refresh`.
- [ ] Показывать folder, path, три action nodes и conversation nodes в требуемом порядке.
- [ ] Реализовать `Open Here`, `Open in New Window` и `Open in File Explorer`.
- [ ] Блокировать открытие missing paths и показывать понятные ошибки.
- [ ] Показывать ошибки источника в view/user notification, а технические подробности — в Output `Kilo Hub`.

## Этап V: Проверка

### V1. Автоматические проверки

- [ ] Typecheck/build проходит.
- [ ] ESLint проходит.
- [ ] Unit tests покрывают полную матрицу projection и adapter.
- [ ] Extension-facing tests покрывают регистрацию, tree nodes, refresh и аргументы команд.
- [ ] Performance test обрабатывает не менее 1 000 sessions без заметной блокировки.

### V2. Доказательство read-only и concurrency

- [ ] Сравнить fingerprints database, WAL и SHM до и после чтения Hub.
- [ ] Выполнить чтение, пока другая connection записывает подтверждённую WAL transaction.
- [ ] Проверить locked/busy и malformed database.
- [ ] Сравнить результат fixture с fixture официального CLI oracle, если live CLI недоступен.

### V3. Ревью

- [ ] Провести независимое ревью требований.
- [ ] Провести независимое ревью безопасности и read-only поведения.
- [ ] Провести ревью содержимого package, зависимостей и лицензий.
- [ ] Исправить все blocking/high findings и записать решения в `reviews/`.

### V4. VSIX

- [ ] Воспроизводимо собрать `dist/kilo-hub-<version>.vsix`.
- [ ] Проверить содержимое архива и наличие runtime-зависимостей и ресурсов.
- [ ] Установить пакет в изолированный профиль и каталог extensions поддерживаемого VS Code.
- [ ] Запустить Extension Development/установленный host и подтвердить активацию без ошибок.
- [ ] Проверить дерево на изолированной тестовой базе.
- [ ] Проверить все три действия folder в изолированном окне.
- [ ] Записать SHA-256, размер, поддерживаемые версии и точные команды.

## План коммитов

1. `chore: add Step 1 execution plan`
2. `feat: add read-only Kilo session projection`
3. `feat: add Kilo folders activity view`
4. `test: cover Step 1 acceptance behavior`
5. `docs: record Step 1 verification and package`

Коммиты могут быть дополнительно разделены, если завершённый и проверенный этап представляет отдельное смысловое изменение. Промежуточные результаты сборки не коммитятся; итоговый запрошенный VSIX коммитится, если этому не препятствуют политика репозитория или ограничение размера.

## Правило завершения

Step 1 завершён только тогда, когда каждый пункт выше либо отмечен выполненным с записанными доказательствами, либо явно отмечен невыполнимым с конкретной причиной среды, а `dist/` содержит проверенный устанавливаемый VSIX. Ограничения среды не позволяют считать функциональное требование пройденным без доказательств.
