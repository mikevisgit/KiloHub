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

Итоговые значения будут внесены после clean package commit:

- source commit: ожидается;
- VSIX path: ожидается;
- размер: ожидается;
- SHA-256 двух последовательных сборок: ожидается;
- exact ZIP entries: ожидается;
- установка и installed Extension Host smoke: ожидается.
