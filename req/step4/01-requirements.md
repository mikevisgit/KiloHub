# Step 4: перенос Kilo Hub на macOS

## 1. Цель

Добавить поддержку локального Kilo Hub на macOS с функциональной эквивалентностью завершённому Step 3, не ухудшая Windows-версию и не расширяя продукт новыми функциями.

Целевые нативные архитектуры:

- Apple silicon: `darwin-arm64`;
- Intel Mac: `darwin-x64`.

Rosetta является отдельным сценарием совместимости и не считается автоматически поддержанной архитектурой. Поддержку Intel VS Code под Rosetta можно заявить только после отдельной installed-host проверки.

## 2. Зависимость от Step 3

Production-реализация Step 4 начинается только после завершения и выпуска Step 3. До этого разрешены постановка задачи и явно предварительное исследование. Нормативным baseline является не текущее состояние `0.2.3`, а точный завершённый результат Step 3 со всеми его production bundles, схемой собственной базы Hub, миграциями, механизмом синхронизации, поисковым стеком, writer coordination, recovery и release evidence.

До завершения Step 3 запрещено:

- окончательно выбирать macOS storage path, file identity, locking или packaging contract;
- менять production-код ради macOS;
- переносить текущие Windows-оценки производительности и безопасности как доказательство macOS;
- считать предварительное исследование достаточным для начала реализации.

## 3. Обязательное повторное исследование

Перед началом реализации Step 4 провести новое исследование по завершённому Step 3. Оно является блокирующим Gate 0 и должно быть записано отдельным актуальным документом с датой, source commit, версией и SHA-256 точного VSIX Step 3.

Повторное исследование обязано заново проверить:

1. Фактический состав Step 3: source/worker/webview bundles, runtime dependencies, схема и migrations Hub DB, выбранный поиск и протокол фоновой синхронизации.
2. Реальное расположение `kilo.db` на macOS для поддерживаемых версии и channel Kilo, включая `KILO_DB`, `XDG_DATA_HOME`, относительные overrides и WAL/SHM.
3. Реальное расположение и область `ExtensionContext.globalStorageUri` для default/named/temporary profiles, нескольких окон, Stable/Insiders и изолированного `--user-data-dir`.
4. POSIX path identity на case-sensitive и case-insensitive APFS, Unicode NFC/NFD, symlink, hard link, rename, `/Volumes` и замене source-файла.
5. Границу поддерживаемой локальности. Network volumes нельзя разрешать или запрещать только по строковому префиксу; решение должно иметь проверяемый контракт.
6. Защиту от совпадения Kilo source, Hub DB и временной rebuild DB по canonical path и фактической file identity до любой writable операции.
7. Multi-window writer ownership, одновременные migration/sync/rebuild, stale owner после crash, SQLite busy, disk full и атомарное переключение восстановленного индекса.
8. Встроенный `node:sqlite`, WAL, Worker Thread, FTS/tokenizer и точную семантику поиска Step 3 в minimum/current VS Code на `darwin-arm64` и `darwin-x64`.
9. Activation без открытой панели, polling, reconciliation, sleep/wake, shutdown и отсутствие оставшегося процесса после закрытия VS Code.
10. Производительность и память на синтетическом корпусе Step 3 отдельно для обеих нативных архитектур.
11. Finder, диалог выбора папки, клавиатурные соглашения macOS и VoiceOver.
12. Стратегию поставки для обеих архитектур: один platform-neutral VSIX либо platform-specific VSIX по результатам Gate 0, воспроизводимость, exact/negative verification и installed smoke без системных Node.js, npm, SQLite CLI и Kilo CLI.

Если после этого исследования изменятся Step 3 scope/стек/модель хранения, поддерживаемая версия или channel Kilo, minimum/current VS Code, macOS, Node/Electron runtime либо build/package toolchain, Gate 0 повторяется для затронутых областей до продолжения реализации.

## 4. Выявленный объём

Уточнение 22 сентября 2026 года: выполнено [повторное исходниковое исследование 0.3.2](../../docs/step4-discovery-0.3.2.md). Baseline: source `ce9fba0906e49f756b17b53bf01b1f94273d0ff8`, Hub schema 3, FTS5 trigram/точный `instr`, durable FIFO и фоновая сверка. Точный VSIX и повторно проверенный SHA-256 записаны в исследовании. Это не закрывает Gate 0: native macOS evidence и подтверждение остаточной ручной приёмки Step 3 отсутствуют.

Текущая версия жёстко ограничена Windows: source resolver и storage guards, drive-letter paths, `node:path.win32`, Windows path normalization/safety, диагностика, fixtures, PowerShell verifier и `win32-x64` packaging. Эти места нельзя исправлять отдельными условными исключениями без общей платформенной модели.

Большая часть Webview, host/Webview protocol, state/revision, presentation, read-only SQLite query и Worker Threads предварительно переносима. Это гипотеза до повторного исследования Step 3, а не доказательство готовности macOS.

Реализованный Step 3 дополнительно увеличивает объём Step 4 следующими областями:

- writable производная Hub DB и её permissions;
- migrations, rebuild и атомарная замена;
- source/Hub file identity и защита Kilo от записи;
- multi-window writer coordination и crash recovery;
- фоновая синхронизация при закрытой панели;
- FTS или иной утверждённый поисковый runtime;
- profile/storage scope и запрет попадания поискового корпуса в Settings Sync;
- повторная проверка производительности, privacy и release package.

Дополнительные обязательные сценарии по исходникам 0.3.2: stale IPC endpoint и ограничения длины Unix socket при рассмотрении этого варианта; GC открытого поколения SQLite при POSIX unlink; crash вокруг pointer rename и явные границы durability; права DB/sidecars/temporary files; переход сохранённых Windows identity к доказанной Darwin policy. Конкретный lock protocol не выбран. Матрица M01–M12 нового исследования уточняет порядок доказательств, не заменяя критерии раздела 7.

## 5. Функциональные границы

- Сохранить функции, данные, поиск и состояния завершённого Step 3 без новых пользовательских возможностей.
- Kilo SQLite остаётся строго read-only. Migrations, индексы, FTS, cleanup и recovery разрешены только для собственной базы Hub.
- Поддерживаются только доказанно локальные folders. Remote SSH, Dev Container, `.code-workspace` и multi-root остаются вне scope, если Step 3 не установит иной нормативный контракт.
- Пользовательские реплики не передаются в Webview, Output, telemetry, release fixtures, VSIX или Settings Sync.
- Действия открытия используют штатные API VS Code; внешний просмотр папки должен быть проверен в Finder.
- Windows Step 3 остаётся поддерживаемым и проходит полный regression gate.
- Native dependency нельзя добавлять без отдельного обоснования ABI, архитектурных пакетов, лицензий и installed tests для обеих архитектур.

## 6. Архитектурное направление без преждевременного выбора

После Gate 0 следует выделить явные Windows и Darwin policies для:

- нормализации и identity папки;
- определения локальности и availability;
- canonical/file identity;
- discovery Kilo storage;
- диагностики и redaction;
- команд открытия;
- packaging и проверки артефактов.

Общими должны остаться projection, поиск, UI, protocol и state machine там, где повторное исследование не докажет платформенную зависимость. Конкретные API, форматы ключей, lock protocol и состав пакетов утверждаются только после Gate 0.

## 7. Предварительные критерии приёмки

- Точный Step 3 baseline и повторное post-Step-3 исследование зафиксированы до первого production commit Step 4.
- Windows Step 3 проходит без регрессии.
- Нативные `darwin-arm64` и `darwin-x64` среды устанавливают и активируют утверждённый Gate 0 артефакт: общий platform-neutral VSIX либо соответствующий platform-specific VSIX.
- Kilo source не изменяется; writable операции физически ограничены Hub storage.
- Folder/source identity доказана на заявленных вариантах APFS и aliases.
- Два окна, crash writer, disk full, rebuild и source replacement проходят автоматические и installed проверки.
- Поиск и синхронизация совпадают с семантикой Step 3, работают без открытой панели и завершаются вместе с VS Code.
- Finder, folder picker, keyboard, VoiceOver, темы и масштаб проходят ручную macOS-приёмку.
- Для каждого target записаны source commit, имя VSIX, размер, SHA-256, runtime matrix и известные ограничения.
- Rosetta не заявляется поддерживаемой без отдельного exact installed-host evidence.

Окончательная матрица и release gate формируются после обязательного повторного исследования.
