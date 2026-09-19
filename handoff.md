# Передача состояния Step 1

## Текущее состояние

- Статус: выполняются планирование реализации и исследование среды.
- Ветка: `master`.
- Исходный коммит: `9642700 Align Step 1 with Kilo SQLite history`.
- В начале работы рабочее дерево было чистым.
- Локальная версия Node.js: `v24.13.0`.
- Локальная версия npm: `11.6.2`.
- Первый найденный в `PATH` совместимый CLI сообщает версию Cursor `1.2.4`; среда хоста Kilo сообщает VS Code `1.138.0`.
- Среда хоста Kilo Code сообщает версию `7.7.5` на `win32-x64`.
- Отдельный CLI `kilo` отсутствует в `PATH`; он не является runtime-зависимостью.

## Источники scope

- Требования продукта: `req/step1/01-requirements.md`.
- Контракт исследования storage: `req/step1/02-discovery.md`.
- Техническое направление: `req/step1/03-technical-plan.md`.
- Приёмка: `req/step1/04-preparation-and-acceptance.md`.
- План выполнения: `specs/step1-implementation-plan.md`.

## Прогресс

- [x] Прочитаны и согласованы между собой все документы требований Step 1.
- [x] Зафиксированы границы отдельных каталогов.
- [x] Запущены независимые исследования SQLite, UI и packaging.
- [x] Подтверждены реальное расположение и schema `kilo.db` на основании read-only данных.
- [ ] Выбран и доказан SQLite runtime внутри упакованного расширения: `node:sqlite` выбран, Extension Host/VSIX proof ещё не выполнен.
- [ ] Реализованы metadata adapter и domain projection.
- [ ] Реализованы Activity Bar view и команды.
- [ ] Завершены автоматические тесты и независимое ревью.
- [ ] VSIX собран, проверен, установлен и прошёл smoke test.
- [ ] Здесь опубликованы точный путь и checksum итогового артефакта.

## Выполненные проверки

- `npm install` создал lockfile с точными dev dependencies.
- После удаления `@vscode/test-cli` и обновления `esbuild` команда `npm audit` сообщает `0 vulnerabilities`.
- `git diff --check` проходит для текущих текстовых изменений.

## Решения

- Kilo остаётся единственным источником истины; реестр Hub и постоянный кэш не создаются.
- Production-код, тесты, спецификации, документация, ревью, промежуточная сборка и дистрибутивы разделены по каталогам.
- Отсутствие отдельного Kilo CLI не блокирует runtime-реализацию; CLI используется только как discovery oracle, когда доступен.
- Пункт реализации не считается завершённым, пока не записаны доказательства проверки.
- Вся проектная документация ведётся на русском языке.
- Расширение выполняется локально с `extensionKind: ["ui"]`, чтобы не читать Windows storage из Remote Extension Host.
- View активирует расширение лениво; параллельные refresh объединяются в одну выполняющуюся операцию.
- Стабильные `TreeItem.id` сохраняют раскрытие папок после refresh; missing actions не получают `command`.
- SQLite `immutable=1` запрещён для работающей WAL-базы, поскольку может скрыть изменения из WAL. Требуется настоящий read-only режим с учётом WAL.
- Для packaging spike выбран встроенный `node:sqlite` без runtime npm dependencies; кандидатный минимум — VS Code `1.105.1`, первый target — `win32-x64`.
- Активная база найдена в `%USERPROFILE%\.local\share\kilo\kilo.db`; SQL и CLI oracle совпали по всем 31 root/non-archived sessions.
- Timestamps `session.time_created` и `session.time_updated` являются Unix milliseconds; schema guard проверяет семь обязательных колонок и разрешает дополнительные.
- Manifest использует положительный allow-list `files`; `.vscodeignore` не создаётся. Packaging автоматически фиксирует ZIP timestamp по последнему Git commit и проверяет запрещённые entries.

## Активные риски

- Реализация SQLite должна работать в Windows Extension Host VS Code и сохранять работоспособность после упаковки в VSIX.
- Определение пути и schema guard требуют доказательств из данных или кода Kilo 7.7.5.
- Если будет выбрана native-зависимость, она должна совпадать с Electron/Node ABI поддерживаемого VS Code.
- Полная UI-проверка может заменить текущий workspace, поэтому установка и действия проверяются в изолированном профиле и окне.
- Версию создателя общей базы нельзя без доказательств выводить из версии установленного VS Code extension; compatibility должен определяться подтверждённой schema signature либо metadata самой базы.

## Следующее действие

Завершить discovery gates D1-D4 в `specs/step1-implementation-plan.md`, записать доказательства в `docs/`, затем реализовать adapter на обезличенных fixtures.
