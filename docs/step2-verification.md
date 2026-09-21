# Проверка и выпуск Kilo Hub Step 2

## Итоговый артефакт

- Source commit: `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9`.
- Путь: `D:\VSCode\KiloHub\dist\kilo-hub-0.2.0-win32-x64.vsix`.
- Размер: `31547` bytes.
- SHA-256: `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`.
- Target: `win32-x64`.
- Extension identity: `local.kilo-hub@0.2.0`.
- `engines.vscode`: `^1.105.1`.
- Extension Host Node: `>=22.19.0 <25`.

## Exact contents

```text
[Content_Types].xml
extension.vsixmanifest
extension/LICENSE.txt
extension/build/extension.js
extension/build/kiloDataWorker.js
extension/build/webview/webview.css
extension/build/webview/webview.js
extension/docs/release-notes.md
extension/package.json
extension/resources/hub.svg
```

Архив не содержит `src/`, `tests/`, fixtures, `req/`, `reviews/`, `old_donotuse/`, demo HTML/themes/scripts, source maps, DB/WAL/SHM, `node_modules/` и runtime npm dependencies.

## Release gate

Нормативная команда:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = '1'
npm run release
```

Команда выполнила два независимых цикла:

```text
npm ci
npm audit --audit-level=high
npm run clean
npm test
npm run package
```

Оба цикла дали одинаковый SHA-256 `69D380AD...07C2`.

После сравнения выполнены:

- development Extension Host на VS Code `1.105.1`;
- development Extension Host на VS Code `1.138.0`;
- negative VSIX verifier: extra entry, missing browser bundle, stale browser bundle, неверный Node engine — все отклонены;
- installed VSIX smoke на VS Code `1.105.1`;
- installed VSIX smoke на VS Code `1.138.0`;
- установка exact VSIX в основной профиль VS Code.

## Automated checks

- TypeScript strict check: PASS.
- ESLint: PASS.
- Unit tests: `62/62`.
- Component tests: `29/29`.
- Extension Host integration minimum/current: PASS.
- Six active design-reference verifiers: PASS.
- Browser bundle forbidden primitive scan: PASS.
- SQLite read-only/query-only/WAL/busy/event-loop/file cleanup: PASS.
- 1000 sessions/folders presenter and chunked browser heartbeat: PASS.
- npm audit: `0 vulnerabilities`.
- Runtime npm dependencies: отсутствуют.

## Read-only и security

- SQLite открывается только `readOnly`, `query_only`, без migrations/checkpoint/journal changes.
- Единственный metadata query читает bounded root/non-archived rows; message/part/project contents не читаются.
- Webview не получает DB, executable URI или command ID.
- Browser messages runtime-валидируются по exact protocol/revision и повторно авторизуются перед side effect.
- CSP запрещает network, inline/eval scripts и внешние assets; browser bundles локальны.
- Persistent Webview state не содержит paths, titles или snapshot.
- Output exceptions и warnings санитизируют local paths/control characters.

## Review exit

- Requirements review exit: достигнут.
- Accessibility review exit: достигнут.
- Security source exit: достигнут.
- Testability source exit: достигнут.
- Package/release final review: `Blocker 0 / High 0 / Medium 0 / Low 0`.
- Verdict: `PACKAGE/RELEASE APPROVED`.

Основные отчёты находятся в `reviews/step2-production-*.md`; сводка исправлений — `reviews/step2-production-remediation.md`.

## Известные ограничения

- Финальная визуальная, NVDA, zoom, theme и реальная проверка трёх folder actions выполняется пользователем по отдельному checklist.
- Current VS Code test host может печатать ambient AgentHost GitHub diagnostics; Kilo Hub browser bundle не содержит network primitives, а его CSP задаёт `connect-src 'none'`.
- `node:sqlite` в Node 22 остаётся experimental API, поэтому minimum/current installed gates обязательны и пройдены.
