# Независимое ревью packaging и зависимостей Step 1

Дата ревью: 2026-09-20.

Область: `package.json`, `package-lock.json`, build/package/verify scripts, allow-list, manifest, зависимости, лицензии, воспроизводимость, фактический состав имеющегося VSIX и стратегия installation/smoke. Финальная упаковка и установка не выполнялись.

## Findings

### BLOCKER-1. Не выполнен обязательный release gate установленного VSIX и полной воспроизводимости

**Ссылки:** `specs/step1-implementation-plan.md:128-134`, `specs/step1-test-matrix.md:146-156`, `handoff.md:29-34`, `docs/release-notes.md:47-49`.

План и handoff прямо фиксируют, что установленный VSIX ещё не проверен, два package-прогона из чистого состояния не выполнены, а итоговые path/size/SHA-256 и smoke evidence не опубликованы. Имеющийся `dist/kilo-hub-0.1.0-win32-x64.vsix` успешно проходит текущий статический verifier, но это не закрывает P-002, P-005, P-006, P-010 и P-011: не доказаны установка в чистый профиль, активация именно из установленного пакета, загрузка `node:sqlite`, read-only/WAL-поведение packaged runtime и три реальные команды открытия.

**Влияние:** выпуск Step 1 и отметка V4/DoD как завершённых заблокированы.

**Требуемое действие:** после устранения остальных blocking/high findings выполнить release pipeline из чистого checkout, дважды получить VSIX и сравнить SHA-256, затем установить именно итоговый файл в изолированные `--user-data-dir` и `--extensions-dir` и пройти smoke-матрицу.

### HIGH-1. `verify:vsix` не доказывает точный состав, платформу и соответствие свежей сборке

**Ссылка:** `scripts/verify-vsix.ps1:10-63`.

Verifier проверяет наличие пяти entries и отсутствие ограниченного набора запрещённых patterns. Он не выполняет следующие проверки:

- точное равенство полного набора entries ожидаемому allow-list;
- обязательное наличие `extension/LICENSE.txt` и `extension/docs/release-notes.md`;
- `TargetPlatform="win32-x64"` в `extension.vsixmanifest`;
- `name`, `publisher`, `version`, `extensionKind`, activation events и полный список разрешённых contributions;
- отсутствие любых неожиданных файлов, не попавших в текущий deny-list;
- байтовое соответствие `extension/build/extension.js` только что созданному `build/extension.js`.

Из-за этого stale, wrong-target или расширенный посторонним файлом архив способен пройти `npm run verify:vsix`. Текущий архив фактически корректен: содержит `TargetPlatform="win32-x64"`, семь ожидаемых ZIP entries, а SHA-256 bundle внутри VSIX совпадает с локальным bundle (`69D4C4CAEB9D3576797FDD61090BA04173B04C7EB71AB93985E62027725DC3F6`). Недостаток относится к release gate, а не к проверенному текущему архиву.

**Влияние:** автоматическая проверка не обеспечивает P-003/P-004 и не предотвращает выпуск неверного артефакта.

**Требуемое действие:** проверять точный отсортированный набор entries, deployment manifest и package manifest, а также hash packaged bundle против свежего build output.

### MEDIUM-1. Имя и версия артефакта дублируются вручную

**Ссылки:** `package.json:5`, `scripts/package.mjs:4`, `scripts/verify-vsix.ps1:3`.

Версия `0.1.0` и имя target-файла независимо захардкожены в трёх местах. После version bump `vsce --out` создаст файл со старым именем, а verifier продолжит проверять его без обнаружения расхождения имени с `extension/package.json.version`.

**Влияние:** возможен выпуск правильно собранного содержимого под неверным версионированным именем и проверка не того файла.

**Требуемое действие:** вычислять artifact path из `package.json` и проверять согласованность имени, package version и VSIX identity.

### MEDIUM-2. Release script не связывает артефакт с чистым набором входов

**Ссылка:** `scripts/package.mjs:5-13`.

ZIP timestamp берётся из последнего commit, но script не проверяет чистоту рабочего дерева. На момент ревью packaging-файлы и `LICENSE.txt` были незакоммичены, а VSIX был untracked; следовательно, время entries указывает на commit `7e7ab39`, хотя содержимое включает более новые рабочие изменения. Это не нарушает детерминированность ZIP, но создаёт ложную provenance-связь и мешает воспроизводимой проверке по commit.

**Влияние:** текущий артефакт нельзя считать финальным воспроизводимым артефактом данного commit.

**Требуемое действие:** выпускать из чистого checkout после `npm ci`; release gate должен падать при tracked/untracked изменениях, кроме заранее очищенного целевого пути `dist/`.

### MEDIUM-3. Версии Node.js и npm для release pipeline не закреплены в репозитории

**Ссылки:** `package.json:9-11`, `package.json:103-112`, `specs/step1-test-matrix.md:146-147`.

Direct dev dependencies закреплены точно, lockfile имеет version 3, но нет `engines.node`, `packageManager`, `.nvmrc`, Volta-конфигурации или CI workflow. При этом `@vscode/vsce` требует Node `>=22`, а фактическое ревью выполнено на Node `24.13.0`/npm `11.6.2`. P-001 требует фиксированной версии среды.

**Влияние:** clean install и build зависят от незафиксированной версии package manager/runtime; доказательство воспроизводимости между машинами неполно.

**Требуемое действие:** закрепить release-версию Node/npm и записывать её в release evidence; минимум должен оставаться совместимым с Node 22 Extension Host target и build tooling.

### MEDIUM-4. Среда по умолчанию отключает проверку TLS для npm

**Ссылка:** `package-lock.json:26-29` и остальные `resolved`/`integrity` entries.

Во время первичного `npm audit` и `npm outdated` Node сообщил `NODE_TLS_REJECT_UNAUTHORIZED=0`. `npm config get strict-ssl` при этом возвращает `true`, то есть ослабление приходит из process environment и затрагивает HTTPS вне npm config. Lockfile содержит HTTPS registry URLs и integrity для всех 283 dependency packages, но будущий `npm ci` в такой среде не должен считаться доверенным release install.

Контрольный `npm audit --json` был повторён с `NODE_TLS_REJECT_UNAUTHORIZED=1` и завершился с code 0, без TLS warning и с нулём vulnerabilities.

**Влияние:** vulnerability result подтверждён, но clean release install остаётся заблокированным до удаления небезопасного environment override.

**Требуемое действие:** удалить `NODE_TLS_REJECT_UNAUTHORIZED=0` из release environment, выполнить новый `npm ci` и audit с TLS verification enabled и сохранить команды/версии.

## Dependency и audit evidence

- `package-lock.json` использует `lockfileVersion: 3`; root version и все девять прямых dev dependencies совпадают с `package.json`.
- Все прямые версии заданы без ranges: `@eslint/js 10.0.1`, `@types/node 22.20.4`, `@types/vscode 1.105.0`, `@vscode/test-electron 3.1.0`, `@vscode/vsce 4.0.0`, `esbuild 0.28.2`, `eslint 10.11.0`, `typescript 5.9.3`, `typescript-eslint 8.70.0`.
- У всех 283 locked dependency packages есть `resolved`, `integrity` и license metadata; отсутствующих integrity/resolution entries не найдено.
- `npm ls --all` завершился без missing/invalid/extraneous errors.
- `npm ls --omit=dev --all --json` вернул только root package: runtime npm dependencies, optional dependencies, peer dependencies и bundled dependencies отсутствуют.
- Secure-TLS `npm audit --json`: `0` info, `0` low, `0` moderate, `0` high, `0` critical; metadata: root prod `1`, dev `283`, optional `47`, peer `6`.
- `npm outdated --json` отметил только более новые major/target-incompatible releases типов и TypeScript; pinned `wanted` совпадает с `current`, поэтому это не release blocker.
- Production source импортирует только локальные модули, Node built-ins, `vscode` и `node:sqlite`. Build оставляет `vscode` и `node:sqlite` external; native npm addon, WASM и `.node`-файлы не требуются.

## Лицензии

- Само расширение объявлено `UNLICENSED` (`package.json:8`) и включает `LICENSE.txt` с явным режимом локального использования; manifest VSIX ссылается на `extension/LICENSE.txt`.
- Реально упакованных third-party runtime dependencies нет, поэтому отдельный production third-party notice для bundle не требуется.
- Все 283 packages являются dev-only. Lockfile license inventory: MIT 223, Apache-2.0 14, ISC 14, BSD-2-Clause 9, Artistic-2.0 5, BSD-3-Clause 3, BlueOak-1.0.0 2, 0BSD 1, `(MIT AND Zlib)` 1, `(MIT OR GPL-3.0-or-later)` 1, `SEE LICENSE IN LICENSE.txt` 10; missing license metadata нет.
- Dual-license/GPL option и `SEE LICENSE` относятся только к нераспространяемым build tools/transitive packages. По текущему package content copyleft-код в VSIX не поставляется.

## Manifest и package content

Проверено без замечаний:

- `engines.vscode` равен `^1.105.1`; это согласовано с доказанным Extension Host Node `22.19.0` и external `node:sqlite`.
- `extensionKind: ["ui"]` удерживает расширение в локальном Extension Host; runtime дополнительно отклоняет non-Windows platform.
- Target задаётся `vsce package --target win32-x64`; существующий deployment manifest содержит `TargetPlatform="win32-x64"`.
- Contributions ограничены одним Activity Bar container, одним view, `Refresh` и тремя требуемыми open-командами; лишних feature contributions нет.
- `files` является положительным allow-list; `.vscodeignore` отсутствует намеренно.
- Два последовательных `npm run bundle` дали одинаковый SHA-256 `69D4C4CAEB9D3576797FDD61090BA04173B04C7EB71AB93985E62027725DC3F6`.
- `@vscode/vsce 4.0.0` при `SOURCE_DATE_EPOCH` сортирует ZIP entries и фиксирует их mtime. В существующем архиве все timestamps соответствуют последнему commit timestamp.

Фактический существующий архив:

- путь: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`;
- размер: `10843` байт;
- SHA-256: `C4EDE6153929FE883318DC8285F2B2F87374449FBF97199D7033F6CC7FFE7143`;
- статус: review artifact, не финальный release из-за BLOCKER-1 и грязного рабочего дерева.

Полный ожидаемый и фактический список ZIP entries:

```text
[Content_Types].xml
extension.vsixmanifest
extension/LICENSE.txt
extension/build/extension.js
extension/docs/release-notes.md
extension/package.json
extension/resources/hub.svg
```

В архиве отсутствуют `node_modules`, TypeScript sources, tests, fixtures, `req`, `specs`, `reviews`, source maps, базы и WAL/SHM sidecars. Hash `extension/build/extension.js` совпадает с текущим production bundle.

## Рекомендуемая install/smoke strategy

1. Создать clean checkout конкретного commit; использовать закреплённые Node/npm, TLS verification enabled и выполнить `npm ci`, `npm audit`, typecheck, lint и полный automated test suite.
2. Дважды выполнить `npm run package` из одинакового чистого состояния, сохраняя полный список entries, размер и SHA-256 обоих файлов. SHA-256 и content list должны совпасть.
3. Создать отдельные пустые каталоги `--user-data-dir` и `--extensions-dir`; не использовать основной профиль или основной extensions directory.
4. Установить итоговый VSIX через CLI целевой версии VS Code `1.105.1` с явными изолированными каталогами и подтвердить через `--list-extensions --show-versions`, что загружен `local.kilo-hub@0.1.0` именно из test extensions directory.
5. Запустить отдельное disposable окно с изолированной `KILO_DB`, без Kilo CLI в `PATH` и без сети. Не запускать smoke на рабочей `kilo.db`.
6. До запуска снять hashes `kilo.db`/WAL, logical session snapshot и directory listing; после activation/refresh повторить. Для SHM применять задокументированное исключение read-marks, не заявлять byte identity.
7. Проверить Activity Bar, lazy activation, tree/filter/sort/fallback/missing states, повторный `Refresh`, отсутствие network/CLI dependency и отсутствие activation/module errors для `node:sqlite`.
8. Проверить `Open Here`, `Open in New Window` и `Open in File Explorer` только на disposable folders/windows; для `Open Here` заранее учитывать завершение текущего Extension Host.
9. Записать версии VS Code/Kilo/Node/Electron, точные команды, activation log, обезличенные результаты, окончательные path/size/SHA-256 и ограничения в release evidence и `handoff.md`.

## Итог

Текущий package content минимален, runtime npm dependencies отсутствуют, license surface приемлема, bundle детерминирован в проверенных прогонах, secure-TLS audit сообщает 0 vulnerabilities. Выпуск остаётся заблокированным до усиления verifier, чистой воспроизводимой package-сборки и полного install/smoke gate установленного VSIX.

## Повторная проверка remediation

Дата повторной проверки: 2026-09-20.

Проверены текущие uncommitted изменения без выполнения `npm run package` и без создания нового финального VSIX.

### Открытый release blocker

#### BLOCKER-1. Фактический clean package/repro/install gate ещё не выполнен

**Ссылки:** `specs/step1-implementation-plan.md:128-134`, `scripts/package.mjs:4-53`, `scripts/run-installed-extension-tests.mjs:7-55`.

Remediation-код для gate подготовлен, но рабочее дерево остаётся грязным, новый VSIX с worker не собирался, два clean package-прогона не выполнялись и SHA-256 двух независимо полученных архивов не сравнивался. Существующий `dist/kilo-hub-0.1.0-win32-x64.vsix` является старым review artifact: новый exact verifier корректно отклоняет его из-за отсутствующего `extension/build/kiloDataWorker.js`.

Это единственный открытый release blocker. Он закрывается только фактическими доказательствами:

- secure-TLS `npm ci` из clean checkout на закреплённых Node/npm;
- полный automated test suite;
- два `npm run package` с одинаковым SHA-256 и точным составом;
- успешный `verify:vsix` для обоих production bundles;
- установка именно проверенного архива в изолированные profile/extensions directories;
- успешный packaged-runtime refresh через worker, read-only/WAL проверки и ручной smoke трёх действий.

### Остаточный test-gap installed harness

**Ссылки:** `scripts/run-installed-extension-tests.mjs:25-55`, `tests/integration/index.ts:168-215`, `src/extension.ts:52-77`.

Runner корректно создаёт отдельные `user-data`/`extensions` directories, устанавливает VSIX в VS Code `1.105.1`, проверяет `local.kilo-hub@0.1.0` через `--list-extensions --show-versions` и запускает tests через отдельный harness extension, поэтому workspace development extension не подменяет установленный пакет.

Однако текущий тест недостаточен как положительное доказательство packaged runtime. На старом VSIX без `kiloDataWorker.js` команда `npm run test:installed` завершилась с code 0. Установленный каталог действительно не содержал worker, а установленный `extension.js` имел старый SHA-256 `69D4C4CAEB9D3576797FDD61090BA04173B04C7EB71AB93985E62027725DC3F6`. Причины:

- runner не выполняет `verify:vsix` перед установкой;
- test подтверждает activation и регистрацию команд, но не подтверждает, что refresh завершился успешной моделью;
- production refresh перехватывает runtime error и завершает command promise без reject, поэтому одной проверки `executeCommand` недостаточно.

Этот gap не создаёт отдельный release blocker сверх BLOCKER-1, но успешный текущий `test:installed` нельзя использовать для его закрытия. Перед зачётом gate runner должен устанавливать только архив, прошедший exact verifier, и иметь наблюдаемое утверждение успешного refresh через packaged worker, а не только activation/command registration.

### Статус исходных findings

- **HIGH-1 закрыт на уровне verifier:** `scripts/verify-vsix.ps1:12-100` проверяет точный набор из восьми entries, наличие worker, identity, entrypoint, engine, `extensionKind`, activation events, точные command IDs, единственные container/view, `TargetPlatform="win32-x64"` и SHA-256 обоих bundles против свежего build output. Негативная проверка на старом архиве с отсутствующим worker сработала ожидаемо.
- **MEDIUM-1 закрыт:** `scripts/package.mjs:4-5` и `scripts/verify-vsix.ps1:4-6` вычисляют имя артефакта из `package.json.name` и `package.json.version`; ручное дублирование `0.1.0` удалено.
- **MEDIUM-2 закрыт на уровне реализации:** `scripts/package.mjs:6-18` отклоняет tracked и untracked изменения, разрешая только ожидаемый untracked target artifact. Фактическое доказательство clean run остаётся частью BLOCKER-1.
- **MEDIUM-3 закрыт:** `.nvmrc` закрепляет Node `22.20.0`, `package.json:9-12` задаёт `npm@11.6.2` и Node `>=22.20.0 <25`, lockfile синхронизирован.
- **MEDIUM-4 закрыт для audit evidence:** `npm config get strict-ssl` вернул `true`; повторный audit был принудительно запущен с `NODE_TLS_REJECT_UNAUTHORIZED=1`, завершился с code 0 и `0 vulnerabilities`. Новый secure-TLS `npm ci` не выполнялся и остаётся предусловием BLOCKER-1.

Остаточный неблокирующий риск verifier: он проверяет разрешённые command/view contributions, но не сравнивает весь packaged `contributes`/`menus` object с source manifest. Clean-tree packaging и ревью source manifest существенно ограничивают риск, однако полное canonical сравнение manifest сделало бы защиту от post-package изменения исчерпывающей.

### Выполненные команды повторной проверки

- `npm run bundle` — успешно; созданы `build/extension.js` и `build/kiloDataWorker.js`.
- `npm run check-types` — успешно.
- `npm run lint` — успешно.
- `npm run test:unit` — 26/26 успешно, включая worker busy/event-loop test.
- `npm run test:integration` — успешно на VS Code `1.105.1`.
- `npx --no-install vsce ls --no-dependencies --tree` — показывает только license, manifest, два production bundles, release notes и SVG.
- secure-TLS `npm audit --json` — 0 vulnerabilities.
- `npm run verify:vsix` — ожидаемо отклонил старый VSIX из-за отсутствующего worker; это положительное доказательство negative path verifier, но не release pass.
- `npm run test:installed` — code 0 на старом VSIX; результат признан false-positive для нового worker runtime и не засчитан как install gate.
- `git diff --check` — ошибок whitespace не найдено.

### Итог повторной проверки

Dynamic artifact naming, clean-tree provenance check, Node/npm pinning, secure audit evidence и exact verification обоих bundles реализованы. Installed-test runner изолирует профиль и действительно загружает установленное расширение, но пока не доказывает успешный refresh новой worker-реализации. Статус выпуска остаётся заблокирован только фактическим clean package/repro/install/smoke gate; новый финальный VSIX в рамках этого ревью не создавался.

## Финальная проверка release artifact

Дата финальной проверки: 2026-09-20.

Проверка выполнена read-only по существующему артефакту и release evidence. Артефакт повторно не собирался и не переупаковывался.

### BLOCKER-1 закрыт

**Статус:** `ЗАКРЫТ`.

Фактический clean package/repro/install gate выполнен. Несоответствий заявленным release-параметрам не найдено.

Подтверждённые параметры:

- source commit: `e77726559169687c66693c3865baaa95f936d7b3` (`e777265 fix: address Step 1 review findings`);
- production/build inputs соответствуют source commit; после выпуска отдельно изменяются только release evidence и сам untracked VSIX;
- артефакт: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`;
- размер: `12857` bytes;
- SHA-256: `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`;
- две последовательные clean package-сборки имеют одинаковый SHA-256 `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`;
- ZIP timestamp соответствует времени source commit, используемому через `SOURCE_DATE_EPOCH`;
- deployment manifest содержит `Version="0.1.0"`, `Publisher="local"`, `TargetPlatform="win32-x64"`, engine `^1.105.1` и `ExtensionKind=ui`;
- packaged manifest содержит ожидаемые identity, engine, activation events, один container/view и четыре нормативные команды;
- runtime npm dependencies и `node_modules` в пакете отсутствуют.

### Exact package verification

Повторный read-only запуск `npm run verify:vsix` завершился успешно и подтвердил ровно восемь entries:

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

Hashes обоих production bundles совпадают между текущим verified build output, VSIX и двумя изолированными installed directories:

- `extension.js`: `16F4DD70983673CEEEA47EBDE3582E27AC879466075A8CD9B19EB47FCBDA72CA`;
- `kiloDataWorker.js`: `19E53E44A3962A6F3BE7C223838277EA443502A88E625C2C91552849002F4356`.

Это закрывает прежний риск stale VSIX без worker и подтверждает, что exact verifier проверяет оба фактически исполняемых bundles.

### Dependency и automated evidence

Release evidence в `docs/verification.md` и `reviews/remediation.md` фиксирует:

- secure-TLS `npm ci` на закреплённых Node/npm;
- `npm audit --audit-level=high`: `0 vulnerabilities`;
- `npm test`: typecheck, ESLint, 27/27 unit/subtests и Extension Host VS Code `1.105.1`, exit code `0`;
- два последовательных `npm run package` с одинаковым SHA-256;
- successful exact verifier после каждой production package-сборки.

### Installed package evidence

`npm run test:installed` прошёл на VS Code `1.105.1` в отдельных `user-data` и `extensions` directories:

- CLI log фиксирует установку именно `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`;
- `extensions.json` фиксирует `local.kilo-hub@0.1.0` с source `vsix`;
- установленный каталог содержит оба production bundles с hashes, совпадающими с VSIX;
- Extension Host log фиксирует activation `local.kilo-hub` по `onCommand:kiloHub.refresh` и завершение host с code `0`;
- strengthened runner предварительно запускает exact verifier, а refresh теперь propagates failure, поэтому прежний false-positive сценарий устранён;
- Output `Kilo Hub` после успешного fixture refresh не содержит runtime errors.

Отдельная Current Stable проверка также подтверждена:

- версия VS Code Stable: `1.138.0`;
- отдельные `build/smoke/user-data` и `build/smoke/extensions`;
- CLI log фиксирует успешную установку финального VSIX;
- последующий isolated `--list-extensions --show-versions` и `extensions.json` подтверждают `local.kilo-hub@0.1.0`;
- installed bundle hashes совпадают с финальным VSIX.

### Остаточный scope

Визуальное нажатие `Open Here`, `Open in New Window` и `Open in File Explorer` в disposable GUI остаётся ручным эксплуатационным smoke. Оно не переоткрывает `BLOCKER-1`: package integrity, reproducibility, installation, activation и packaged worker refresh доказаны; command references, повторная path-проверка и exact VS Code API options покрыты автоматическими проверками.

### Финальный вывод

`BLOCKER-1` закрыт. Финальный VSIX соответствует source commit `e777265`, воспроизводим по сохранённому release evidence, проходит exact проверку восьми entries, устанавливается и активируется из изолированного каталога на минимальном VS Code `1.105.1` и Current Stable `1.138.0`. Открытых blocking/high packaging findings не осталось.
