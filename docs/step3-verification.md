# Выпуск Step 3

## Auto-search0.3.2

Source `ce9fba0906e49f756b17b53bf01b1f94273d0ff8`. Артефакт `D:\VSCode\KiloHub\dist\kilo-hub-0.3.2-win32-x64.vsix`,55469bytes,SHA-256 `36227DB87DCC66B4E504E401E55852FF412883126CD2BA94B2CA546A08D29E67`. Полный `npm run release` exit0 в clean detached checkout: два одинаковых clean/full/package цикла112unit/39component, audit0,7negative, dev/installed1.105.1/1.138.0 с controlled PATH. Package review PASS:13entries,5bundles,README/icons/source сверены. Основной VS Code подтвердил установленный local.kilo-hub@0.3.2.

Поиск применяет валидный запрос после300ms, Enter немедленно, очистка/IME/dispose и отложенный chunk-render проверены. Схема/импорт не менялись. Пользовательский visual verdict и применение через Reload Window в ранее открытом окне не объявляются выполненными автоматически.

## Исправление0.3.1

Установлен `local.kilo-hub@0.3.1`. Source `39caca5b68801db379b436885df8f4e19c9f0331`; файл `D:\VSCode\KiloHub\dist\kilo-hub-0.3.1-win32-x64.vsix`,55004bytes,SHA-256 `EB87BB225F32E9F85C118AB729B03B152DC4602DA08A11D50C6B2AFF346CC5A7`.

Полный `npm run release` на этом commit завершился exit0: два clean ci/audit/test/package цикла,112unit/35component каждый, одинаковый checksum,7negative cases, development и installed1.105.1/1.138.0 с controlled PATH. Audit0. Предыдущая попытка на8b3832e остановилась на EBUSY cleanup; исправление39caca5 переносит удаление synthetic fixtures в parent после выхода Extension Host, без отключения assertions или изменения production.

Независимый package review:0/0/0/0, PACKAGE APPROVED.13entries,5bundles и текстовые/assets Git blobs сверены. Основная установка `code.cmd --install-extension ... --force` успешна; CLI подтвердил0.3.1. Поиск принимает короткие слова внутри запроса от3символов; схема и импорт не менялись. Реальная пользовательская приёмка/reload открытого окна остаётся отдельной.

## Исходный выпуск0.3.0

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
