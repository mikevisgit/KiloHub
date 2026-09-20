# Kilo Hub 0.1.0

## Назначение

Первая версия Kilo Hub показывает в Activity Bar локальные папки Windows, для которых в текущей локальной базе Kilo есть обычные root sessions без архива. Папку можно открыть в текущем окне, новом окне или Проводнике Windows.

## Возможности Step 1

- нативное представление `Kilo Folders` без webview;
- плоский список имён папок;
- раскрываемые полный путь, три действия и названия диалогов;
- сортировка по времени последней Kilo-активности;
- ручной `Refresh`;
- состояние missing для удалённой или недоступной папки;
- read-only чтение metadata из `kilo.db` с учётом WAL;
- работа без отдельной установки Kilo CLI и без сети.

## Поддерживаемая среда

- Windows x64;
- VS Code `1.105.1` или новее в пределах major `1.x`;
- Kilo Code `7.7.5` или более новая версия с совместимой schema таблицы `session`;
- текущая локальная Kilo database/environment.

## Ограничения

Step 1 не поддерживает:

- `.code-workspace` и multi-root workspaces;
- UNC paths;
- mapped network drives и reparse points, которые разрешаются в UNC target;
- Remote SSH, WSL и Dev Container paths/URI;
- архивные и дочерние agent sessions;
- автоматическое отслеживание изменений без ручного `Refresh`;
- открытие конкретного Kilo-диалога;
- ручное добавление, удаление или скрытие папок;
- импорт VS Code `Open Recent`;
- legacy task JSON;
- summary, LLM, embeddings и поиск по телам сообщений;
- Hub API, MCP, telemetry и облачную синхронизацию.

Папка, удалённая с диска, остаётся в списке, пока в Kilo существует связанная session. Действия открытия такой папки заблокированы.

## Конфиденциальность и данные

Расширение выбирает только ID, title, directory, timestamps и признаки parent/archive. Тела сообщений и содержимое файлов проектов не читаются. Kilo storage открывается read-only; расширение не выполняет migrations, checkpoint, изменение journal mode или записи.

## Сборка

Версия распространяется как platform-specific пакет `kilo-hub-0.1.0-win32-x64.vsix`. Точный checksum и результаты release gate записываются в корневой `handoff.md`, который не включается в runtime-пакет.
