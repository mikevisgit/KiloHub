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

## Статус выпуска

Документ является release candidate и будет дополнен точным именем VSIX, checksum и результатом smoke test после завершения release gate.
