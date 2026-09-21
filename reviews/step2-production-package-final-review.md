# Step 2 — финальное независимое package/release review

## Findings

Findings не обнаружены.

Итоговые открытые severity: **Blocker 0 / High 0 / Medium 0 / Low 0**.

## Объект и границы

- Source commit: `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9` (`test: harden Step 2 negative VSIX verifier`).
- Артефакт: `D:\VSCode\KiloHub\dist\kilo-hub-0.2.0-win32-x64.vsix`.
- Размер: `31547` bytes.
- SHA-256: `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`.
- Проверка выполнена без пересборки и без изменения artifact, source, tests, requirements, specs, release docs или handoff. Создан только этот отчёт.
- Прочитаны `agents.md`, `handoff.md`, планы Step 1/Step 2, Step 2 test matrix и manual checklist, `package.json`, полный `package-lock.json`, build/package/exact-verifier/repro/release/install scripts и все предшествующие `reviews/step2-production-*.md` review/remediation отчёты.
- Старый `dist/kilo-hub-0.1.0-win32-x64.vsix` не использовался как evidence Step 2.

## Commit и provenance

- `git rev-parse HEAD` вернул полный target commit `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9`.
- `git status --short --branch` показал `master` и только ожидаемый untracked release artifact `dist/kilo-hub-0.2.0-win32-x64.vsix`; tracked source чист.
- `git diff --check` прошёл. Release inputs `package.json`, lockfile и build/package/verify/release/install scripts не имеют diff относительно `HEAD`.
- Commit timestamp: `2026-09-21T05:04:41+03:00`, Unix `1789956281`. Все десять ZIP entries имеют UTC timestamp `2026-09-21T02:04:40Z`, что соответствует `SOURCE_DATE_EPOCH` commit с двухсекундной точностью ZIP/DOS timestamp.
- `scripts/package.mjs` разрешает при packaging только чистое tracked tree и ожидаемый untracked artifact, получает `SOURCE_DATE_EPOCH` из последнего commit и вызывает `vsce package --target win32-x64 --no-dependencies`.
- Сохранённый протокол окончательного `npm run release` фиксирует запуск на чистом commit `48d5884`, два независимых полных цикла и одинаковый итоговый SHA-256 `69D380AD…07C2`. Предыдущий artifact с SHA `178CE485…D444`, созданный до последнего verifier-harness commit, корректно не используется как release candidate.

## Exact archive

Read-only запуск `scripts/verify-vsix.ps1`, независимый `tar -tf` и прямое чтение ZIP подтвердили ровно 10 entries:

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

Иных entries нет. Следовательно, архив не содержит `tests/`, fixtures, `req/`, `reviews/`, `old_donotuse/`, demo HTML/CSS/JS, source maps, TypeScript source, БД, WAL/SHM, `node_modules/` или прочие неразрешённые файлы.

`npm exec -- vsce ls --tree --no-dependencies` независимо выбрал только восемь extension payload files: license, package manifest, четыре production outputs, release notes и icon. Два остальных entry являются служебными файлами VSIX.

## Bundle hashes

Хэши каждого entry вычислены непосредственно из неизменяемого ZIP и совпали с существующими `build/` outputs. Те же четыре хэша получены для установленной Stable-копии `build/installed-smoke/stable/extensions/local.kilo-hub-0.2.0`.

| Bundle | Bytes | SHA-256 |
| --- | ---: | --- |
| `extension/build/extension.js` | 35845 | `D4D414D01D6BEAC12F7C452E9A1E9589473A3613C7CF1509171B3C97DE075BD4` |
| `extension/build/kiloDataWorker.js` | 7696 | `D1D801866EADC1E3D1676E96BFB5F15A1ACEA6C0323CF4E38B9C43B70A4D7BD3` |
| `extension/build/webview/webview.js` | 32044 | `F67AAE30EF5DD90FB716CB8C3E45E13553DAF75D5B5A296B9D38C340F205DAD7` |
| `extension/build/webview/webview.css` | 6951 | `22AD907DD09880252565E086CBA423DB45EC12F7C82EE8A44C48CFD95BDE5A0F` |

Read-only `npm run verify:webview-bundle` прошёл для существующего browser bundle: `PASS webview bundle scan (32044 bytes)`. Запрещённые CommonJS/Node imports, network primitives, `eval` и source-map marker не найдены; обязательные browser protocol markers присутствуют.

## Manifest и зависимости

Прямое чтение `extension/package.json` и `extension.vsixmanifest` подтвердило:

| Поле | Фактическое значение |
| --- | --- |
| Identity | `local.kilo-hub@0.2.0` |
| Target | `win32-x64` |
| Entry point | `./build/extension.js` |
| `engines.vscode` | `^1.105.1` |
| `engines.node` | `>=22.19.0 <25` |
| `extensionKind` | единственное значение `ui` |
| View | `kiloHub.folders`, имя `Kilo Hub`, `type: "webview"` |
| Activation | `onView:kiloHub.folders`, `onCommand:kiloHub.refresh` |
| Commands | ровно четыре заявленных `kiloHub.*` command ID |

`extension.vsixmanifest` содержит `Identity Version="0.2.0" Publisher="local" TargetPlatform="win32-x64"` и VS Code engine `^1.105.1`. Старого `view/title` contribution нет.

- `npm ls --omit=dev --all` вернул пустое production runtime tree.
- Root manifest не имеет `dependencies`, `optionalDependencies` или `bundledDependencies`; все закреплённые lockfile packages являются dev-only.
- Secure-TLS повтор `NODE_TLS_REJECT_UNAUTHORIZED=1 npm audit --audit-level=high` вернул `0 vulnerabilities`.
- Полный `npm ls --all` не выявил invalid/extraneous packages; отсутствующие optional binaries относятся к другим платформам и не являются runtime package surface.

## Два clean release cycle

`scripts/release.mjs` исполнимо задаёт два независимых цикла:

```text
npm ci
npm audit --audit-level=high
npm run clean
npm test
npm run package
```

Для каждого цикла `clean` удаляет `build/` и `build-tests/`, `npm test` повторяет types/lint/unit/component/minimum Extension Host, а `package` заново создаёт четыре outputs и запускает exact verifier. После циклов script сравнивает два полных SHA-256 до Current/negative/installed gates.

Сохранённый release-протокол окончательного запуска подтверждает:

- оба clean cycle завершились успешно на `48d5884`;
- первый SHA-256 = `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`;
- второй SHA-256 = `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`;
- текущий неизменённый artifact имеет тот же SHA-256 и размер `31547` bytes.

Воспроизводимость release candidate подтверждена byte-for-byte.

## Negative verifier cases

Target commit `48d5884` изменяет только `scripts/test-vsix-verifier.ps1` и устраняет PowerShell 5.1 handling ожидаемых child-process ошибок, не меняя production или package payload.

Финальный negative harness создаёт четыре отдельные повреждённые копии и требует ненулевой exit exact verifier для каждой:

| Case | Ожидаемая причина reject | Результат окончательного release run |
| --- | --- | --- |
| Extra `extension/unexpected.txt` | exact allow-list mismatch | Отклонён |
| Удалён `extension/build/webview/webview.js` | missing required entry | Отклонён |
| Browser bundle заменён строкой `stale` | packaged/current build hash mismatch | Отклонён |
| `engines.node` заменён на `>=99` | exact Node engine mismatch | Отклонён |

Сохранённый протокол `npm run release` прямо фиксирует успешное отклонение всех четырёх invalid cases. Повторно создавать mutated archives в этом read-only review не требовалось и не выполнялось.

## Installed minimum/current evidence

Окончательный `npm run release` после hash equality и negative verifier выполнил `test:installed:min` и `test:installed:current` для того же artifact. Оба runner перед установкой повторно запускают exact verifier, удаляют свой isolated smoke root, устанавливают VSIX с `--force` в отдельные `--user-data-dir`/`--extensions-dir`, требуют строку `local.kilo-hub@0.2.0` из `--list-extensions --show-versions` и только затем запускают Extension Host test.

Успешный installed test семантически подтверждает не только регистрацию:

- `workbench.view.extension.kiloHub` должен создать реальный установленный Webview;
- публичный `kiloHub.refresh` fail-closed ждёт реальный versioned browser `ready`; без packaged JS, CSP/asset load или handshake DB read не начинается и тест падает;
- extension активируется по `onView:kiloHub.folders`;
- refresh проходит через установленный `extension.js` и установленный `kiloDataWorker.js` к обезличенной SQLite fixture;
- до и после refresh сравнивается полный sorted fingerprint всех файлов fixture directory: имена плюс SHA-256; равенство доказывает неизменность DB/sidecars;
- fixture содержит одну допустимую root session, исключённые child/archive rows и не читает message bodies;
- minimum дополнительно требует Node `22.19.0`, Electron `37.6.0` и рабочий `node:sqlite`.

Результаты окончательного release-протокола:

| Host | Installed identity | Browser handshake | Packaged worker refresh | Fixture fingerprints | Результат |
| --- | --- | --- | --- | --- | --- |
| VS Code `1.105.1` | `local.kilo-hub@0.2.0` | PASS | PASS | до/после равны | PASS, exit 0 |
| VS Code Stable `1.138.0` | `local.kilo-hub@0.2.0` | PASS | PASS | до/после равны | PASS, exit 0 |

Существующий Current installed-smoke дополнительно проверен напрямую:

- `build/installed-smoke/stable/extensions/extensions.json` фиксирует `local.kilo-hub`, version `0.2.0`, source `vsix`;
- `cli.log` фиксирует установку exact path `dist/kilo-hub-0.2.0-win32-x64.vsix` с `--force` в VS Code `1.138.0` и успешное завершение установки;
- `exthost.log` фиксирует discovery установленного `local.kilo-hub-0.2.0`, активацию `local.kilo-hub` по `onView:kiloHub.folders` и exit code `0`;
- четыре installed bundle hash совпадают с ZIP и current build hashes из таблицы выше.

После minimum runner следующий `test:installed:current` сначала выполняет `npm run bundle`; `scripts/build.mjs` рекурсивно удаляет весь `build/`, поэтому сохранённый `build/installed-smoke/1.105.1` ожидаемо удаляется и на диске остаётся только последний `stable` каталог. Это свойство pipeline не отменяет minimum PASS, записанный полным release-протоколом, и объясняет отсутствие второго persistent smoke directory.

Найденные в Stable logs предупреждения встроенных Git/GitHub/Agent Host компонентов не относятся к Kilo Hub. Kilo Hub activation/runtime error отсутствует; Extension Host завершился с code `0`.

## Предыдущие reviews

- Исходный production review cycle имел пересекающиеся findings `Blocker 1 / High 10 / Medium 20 / Low 6`.
- Последовательные remediation и targeted re-review закрыли browser heartbeat, authorization races, resource budgets, lifecycle/ready, CSP/assets, diagnostics, focus/tooltip/theme/contracts, traceability и package orchestration.
- Последние source verdicts на `30c0d5b` дали Requirements/Accessibility `0/0/0/0`, Security `0/0/0/0`; testability source exit на `928e246` — PASS с package artifact как единственным тогда ещё pending gate.
- Commit `4f0517a` записал source review exit; `48d5884` содержит только финальное исправление negative-verifier harness. Production source и package inputs после закрывающих source reviews не изменялись.
- Текущий exact package/repro/negative/install evidence закрывает прежний artifact Blocker. Открытых package findings не осталось.

## Остаточные manual gates

Пользовательский `req/step2/04-manual-acceptance-checklist.md` остаётся незаполненным. Поэтому не объявляются пройденными:

- pixel-level и субъективная визуальная приёмка;
- реальная Chromium geometry при 260/320/400 CSSpx, zoom 100/200% и Windows scaling;
- четыре встроенные темы, forced colors, custom themes best effort и фактический contrast;
- keyboard-only/NVDA announcements, focus painting и tooltip hit-testing;
- воспринимаемые accordion motion/scroll compensation;
- реальные GUI actions в disposable окнах/Explorer;
- ручные refresh/error/1000-session observations.

Это обязательный пользовательский gate M9 для полного завершения Step 2, но **не package blocker**: целостность архива, provenance, reproducibility, negative verification, установка, activation, browser handshake, packaged worker refresh и DB fingerprints уже доказаны автоматическим M8 evidence на одном commit/hash.

## Release verdict

**PACKAGE/RELEASE APPROVED.** Артефакт `dist/kilo-hub-0.2.0-win32-x64.vsix` на source commit `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9`, размером `31547` bytes и SHA-256 `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2` проходит финальный package/release gate.

Package review exit: **PASS, Blocker 0 / High 0 / Medium 0 / Low 0**. Этот exact VSIX допустим как единый release candidate для пользовательского manual checklist. Полную пользовательскую визуальную приёмку Step 2 до заполнения M9 считать `Не проверено`, а не `Пройдено`.
