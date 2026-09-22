# Выпуск Step 3

Дата: 22 сентября 2026 года. `local.kilo-hub@0.3.0`, Windows x64.

- Source: `b6bac3ff36bfdac2683f1bad62aa1b54ac4dc7dc`.
- Файл: `D:\VSCode\KiloHub\dist\kilo-hub-0.3.0-win32-x64.vsix`.
- Размер:54697bytes.
- SHA-256: `27EF318A3735E9D84CF107FE3329C29674D9A87EC9EBB4379827C89652F6038A`.

`npm run release` запускался из чистого detached worktree `C:\Users\GRAM\AppData\Local\Temp\kilo\hub-release-b6bac3f`. Два независимых ci/audit/clean/test/package цикла прошли:111unit,34component, minimum devhost и одинаковый hash. Current devhost и7negative cases также прошли.

Первый installed-min упал в teardown: тест импортировал repository-копию extension.js вместо установленной. Исправлен только tests/integration/index.ts: импорт из activeExtension.extensionPath. Assertions не удалялись, production/VSIX не менялись. Затем `npm run test:installed:min` и `npm run test:installed:current` прошли на1.105.1/1.138.0. Это продолжение проверки того же артефакта, не утверждение exit0 первоначального release.mjs.

Installed PATH ограничен Windows/System32; where.exe проверил отсутствие node/npm/sqlite3/kilo и shims. Node физически с машины не удалялся. Источник синтетический, задан до активации; личная переписка не читалась.

Exact verification:13entries,5bundle hashes,2icons,README/Details asset,manifest/engines/target. Нет DB/sidecars/tests/fixtures. Независимый package review: PACKAGE APPROVED. В основной профиль пакет установлен абсолютной командой `D:\Programs\Microsoft VS Code\bin\code.cmd --install-extension ... --force`; список extensions подтвердил0.3.0. После удаления пользователем установка повторена успешно.

Пользовательская приёмка Details, native picker, тем/размеров/200% zoom и NVDA остаётся открытой. Для применения в ранее открытом окне может требоваться Reload Window. Подготовка выполняется в фоне и может отставать; неизвестный формат источника/control files и нехватка ресурсов обрабатываются безопасным отказом с last-good, без изменения Kilo.
