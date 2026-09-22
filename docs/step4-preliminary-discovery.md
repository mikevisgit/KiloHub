# Step 4: предварительное исследование переноса на macOS

## Статус и ограничение

Исследование выполнено 21 сентября 2026 года по Windows production `0.2.3` и незавершённому нормативному пакету Step 3. Оно предназначено только для постановки будущей задачи. Перед реализацией Step 4 исследование обязательно повторяется по завершённому Step 3; текущий документ не закрывает этот gate.

Личная база Kilo и тела сообщений не читались. macOS runtime и установленный VSIX не запускались. Утверждения о будущей реализации Step 3 не делаются: её стек ещё не согласован.

## Подтверждённые Windows-зависимости текущего кода

| Область | Доказательство |
| --- | --- |
| Runtime | `src/extension.ts` отклоняет `process.platform !== 'win32'`. |
| Kilo storage | `src/kiloDataSource.ts` использует `node:path.win32`, drive-letter paths, `USERPROFILE` и отклоняет другие платформы. |
| Projection | `src/projection.ts` принимает Windows drive/file URI, Windows separators/reserved names и case-insensitive key. |
| Safety/actions | `src/windowsPathSafety.ts` и `src/commands.ts` проверяют drive/UNC/extended Windows paths. |
| Current/presentation | `src/currentFolder.ts` и `src/presentation.ts` наследуют Windows path identity. |
| Diagnostics | `src/diagnostics.ts` скрывает Windows/UNC paths, но не POSIX paths. |
| Packaging | `scripts/package.mjs` создаёт только `win32-x64`; PowerShell verifier требует тот же target. |
| Tests | Fixtures и installed/release orchestration ориентированы на Windows и PowerShell. |

## Предварительно переносимые области

- Webview DOM/CSP/CSS и host/Webview protocol;
- state/revision и last-good поведение;
- presentation без path identity;
- Worker Threads;
- read-only SQLite pattern через встроенный Extension Host `node:sqlite`;
- штатный `vscode.openFolder`;
- отсутствие runtime npm dependencies и поставляемых native `.node` addons в `0.2.3`.

Это оценка текущего кода. Step 3 добавит собственную writable базу, migration/rebuild, writer coordination, background sync и поисковый runtime, поэтому процент переносимости необходимо пересчитать после его завершения.

## Влияние Step 3

По `req/step3/01-requirements.md` и `specs/step3-implementation-plan.md` будущий перенос должен охватить не одну read-only Kilo DB, а систему из source Kilo DB, производной Hub DB, фонового worker, синхронизации, reconciliation, поиска, нескольких окон и recovery. Особого macOS discovery потребуют:

- permissions и sidecars writable Hub SQLite;
- `globalStorageUri` и фактическая область profiles/windows;
- canonical path и file identity для source/Hub/rebuild;
- locking и атомарная замена на APFS;
- case sensitivity, Unicode normalization, symlink/hard link и `/Volumes`;
- FTS/tokenizer и search correctness в конкретном Extension Host;
- sleep/wake и shutdown фонового worker;
- POSIX redaction пользовательских путей.

## Архитектуры Mac

VS Code поддерживает platform targets `darwin-arm64` и `darwin-x64`, а также fallback package без platform target. Текущий Hub не поставляет native runtime dependency, поэтому Gate 0 должен сравнить один platform-neutral VSIX с отдельными target-пакетами; форма поставки пока не выбрана. Если Step 3 добавит native addon, потребуется отдельная ABI и architecture matrix.

Intel VS Code под Rosetta на Apple silicon рассматривается как отдельный кандидатный x64-сценарий. Архитектуру фактического Extension Host необходимо записать runtime-probe в Gate 0; Rosetta не заменяет native `darwin-arm64` и не доказывает поддержку настоящего Intel Mac.

## Первичные внешние ориентиры

- VS Code, platform-specific extensions: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions>.
- VS Code, Extension Host и `extensionKind`: <https://code.visualstudio.com/api/advanced-topics/extension-host>.
- VS Code API, `ExtensionContext.globalStorageUri`: <https://code.visualstudio.com/api/references/vscode-api#ExtensionContext>.
- Node.js 22.19, `node:sqlite`: <https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html>.
- Node.js 22.19, `fs.Stats.dev`/`ino`: <https://nodejs.org/download/release/v22.19.0/docs/api/fs.html#statsdev>.
- Apple, Rosetta: <https://support.apple.com/en-us/102527>.
- Kilo Code `7.7.5`, platform targets: <https://github.com/Kilo-Org/kilocode/blob/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb/packages/kilo-vscode/script/build.ts>.
- Kilo Code `7.7.5`, macOS release jobs: <https://github.com/Kilo-Org/kilocode/blob/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb/.github/workflows/publish.yml>.
- Kilo Code `7.7.5`, data root: <https://github.com/Kilo-Org/kilocode/blob/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb/packages/core/src/global.ts>.
- `xdg-basedir@5.1.0`, значения XDG по умолчанию: <https://github.com/sindresorhus/xdg-basedir/blob/v5.1.0/index.js>.

Upstream Kilo использует XDG-oriented data root, поэтому `~/.local/share/kilo/kilo.db` является кандидатом и на macOS для исследованного commit, но не нормативным путём. Его необходимо подтвердить live-probe для фактически поддерживаемой версии/channel после Step 3.

## Вывод

Процессоры Mac сами по себе не являются главным риском, пока runtime предоставляет VS Code и нет native addon. Главный объём создают файловая семантика macOS и будущая архитектура Step 3. Реализация разрешается только после нового post-Step-3 discovery, описанного в `req/step4/01-requirements.md`.
