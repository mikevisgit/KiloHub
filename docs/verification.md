# Проверка Step 1

## Среда

| Компонент | Версия |
|---|---|
| Windows | win32-x64 |
| Локальный Node.js | `24.13.0` |
| Закреплённый release Node.js | `22.20.0` |
| npm | `11.6.2` |
| Минимальный VS Code test host | `1.105.1` |
| Node.js / Electron минимального host | `22.19.0` / `37.6.0` |
| Текущий VS Code Stable | `1.138.0` |
| Kilo Code | `7.7.5-win32-x64` |

## Автоматические проверки

### TypeScript и lint

```powershell
npm run check-types
npm run lint
```

Обе команды проходят после worker/remediation изменений.

### Unit и SQLite integration

```powershell
npm run test:unit
```

Последний pre-package прогон: 27/27 tests. Покрыты resolver, version/schema guard с реальной primary-key semantics, metadata-only SQL, read-only/query-only, WAL visibility, DB/WAL fingerprints, bounded busy timeout, event-loop responsiveness worker, cleanup, path normalization, deterministic grouping, sorting, missing state, 1 000 sessions, concurrency limit и resolved local path checks.

### Extension Host

```powershell
npm run test:integration
```

Production bundle загружается в downloaded VS Code `1.105.1`. Проверяются версии Node/Electron, доступность `node:sqlite`, manifest, четыре команды, tree contract, refresh activation и неизменность fixture database.

### Зависимости

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='1'
npm install --package-lock-only
npm audit --audit-level=high
npm ls --omit=dev --all
```

Secure-TLS audit сообщает `0 vulnerabilities`; production runtime dependencies отсутствуют.

## Read-only доказательства

- SQLite открывается только с `readOnly: true`, `allowExtension: false`, `query_only=ON`.
- SQL выбирает семь metadata columns только из `session` и фильтрует `parent_id IS NULL`, `time_archived IS NULL`.
- Connection живёт в отдельном worker и закрывается в `finally`.
- Committed WAL row виден reader.
- DB и WAL остаются побайтово неизменными; logical sessions не меняются.
- Существующий SHM может менять технические read-marks, что не является записью данных Kilo.
- Exclusive lock возвращает bounded busy error, при этом timer Extension Host продолжает выполняться.

## Packaging gate

- Source commit: `e777265 fix: address Step 1 review findings`.
- VSIX: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`.
- Размер: `12857` bytes.
- SHA-256 первой clean сборки: `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`.
- SHA-256 второй clean сборки: `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`.
- `npm run verify:vsix`: пройден, проверены exact entries, manifests, target и hashes обоих bundles.
- `npm run test:installed`: пройден на VS Code `1.105.1`; загружен harness как development extension, а `local.kilo-hub@0.1.0` установлен из проверенного VSIX в отдельный extensions directory. Refresh успешно использовал packaged worker.
- Hashes установленных `extension.js` и `kiloDataWorker.js` совпали с fresh build: `16F4DD70...72CA` и `19E53E44...4356`.
- VS Code Stable `1.138.0`: isolated install прошёл, `--list-extensions --show-versions` вернул `local.kilo-hub@0.1.0`.

Exact entries:

```text
[Content_Types].xml
extension.vsixmanifest
extension/LICENSE.txt
extension/build/extension.js
extension/build/kiloDataWorker.js
extension/docs/release-notes.md
extension/package.json
extension/resources/hub.svg
```

## Release команды

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='1'
npm ci
npm audit --audit-level=high
npm test
npm run package
npm run package
npm run test:installed
```

Результат: audit `0 vulnerabilities`, 27/27 tests, development и installed Extension Host exit code `0`, два VSIX hash совпали.

## Ручные ограничения

Стандартные вызовы `vscode.openFolder` проверены по exact options, а Explorer использует `vscode.env.openExternal(fileUri)` после повторной local-directory проверки. Автоматический installed smoke намеренно не выполняет реальные переходы окон, чтобы не завершать test host и не оставлять окна/Explorer. Визуальный клик-тест трёх действий остаётся ручным эксплуатационным smoke, а не блокером целостности package/runtime.
