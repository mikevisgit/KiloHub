# Step 2 — независимое ревью production-требований

## Findings

### High — большой snapshot рендерится синхронно и блокирует browser event loop

**Файл:** `src/webview/main.ts:675-713`

`renderState` одним непрерывным циклом удаляет, создаёт, обновляет и переставляет все карточки, а для каждой новой карточки синхронно создаёт actions, conversations и несколько tooltip-узлов. Yield, порций и event-loop sentinel в production-коде нет. При этом protocol допускает до 10 000 folders (`src/webviewProtocol.ts:3-10`), а для одной карточки заранее создаются даже action-кнопки и tooltip, которые затем могут быть удалены из карточки по current/missing matrix.

Это прямое расхождение с каноном (`ТЗ`, строка 146), планом M4 (`specs/step2-implementation-plan.md:155`) и `PERF-01`: во время большого refresh должен выполниться хотя бы один запланированный heartbeat, а busy-индикатор должен быть показан до тяжёлой обработки. Unit-тест на 1 000 conversations проверяет только presenter и три DTO-title; component suite не отправляет большой folder snapshot и не доказывает heartbeat browser-части.

**Последствие:** большой валидный snapshot может надолго заморозить Webview, keyboard/focus и обработку refresh, несмотря на сохранённую отзывчивость Extension Host/SQLite worker.

### High — host авторизует action по устаревшему `current`, не пересчитывая workspace перед выполнением

**Файл:** `src/kiloHubWebviewProvider.ts:216-231`

`handleFolderAction` проверяет revision, наличие folder и сохранённый `folderDto.current`, после чего сразу вызывает executor. Обязательный повторный вызов `workspaceDescriptor()` + `resolveCurrentFolder(...)` перед authorization отсутствует. Свежий `stat`/`realpath` выполняется ниже в `executeFolderAction`, но он проверяет только доступность/локальность пути и не исправляет устаревшее current-состояние.

Это нарушает точное требование `ТЗ:126` и матрицу `PROTO-03`: host должен заново вычислять current перед каждым действием и не доверять состоянию, показанному Webview. Между событием смены workspace и завершением асинхронного `workspaceChanged()` старая карточка может отправить `openHere`/`openNewWindow` для папки, которая уже стала current.

**Последствие:** host допускает действие, которое по актуальной action matrix должно быть запрещено. Integration test меняет workspace только через предварительный `workspaceChanged()` и не покрывает race/action-time revalidation.

### Medium — production-композиция расходится с утверждённым макетом и размерной спецификацией

**Файлы:** `src/webview/main.ts:89-113`, `src/webview/main.ts:406-420`, `src/webview/main.ts:467-483`, `src/webview/styles.css:50-56`, `src/webview/styles.css:253-265`

В утверждённом reference actions являются текстовыми кнопками без отдельных иконок (`req/step2/variants/build-final.mjs:9-13`), а размерное приложение прямо фиксирует: «отдельной иконки действия сейчас нет» (`design-size-spec.md:64`). Production добавляет три новых glyph `→`, `↗`, `⌕`, отдельный `.action-icon` и дополнительную колонку. В результате меняются утверждённые переносы, визуальная иерархия и ширина текста кнопок; установленный gap также равен `6/13B`, а не зафиксированным 8 px.

Кроме того, reference использует `ⓘ`, production рисует обычную букву `i`, а `.hub` не переносит нормативные border и нижний padding панели из `design-size-spec.md:43,70-83`. Это не адаптация к теме и не техническое ограничение Webview, а незаявленное изменение полностью принятой композиции по УТЗ-03.

### Medium — accessible name плашки дублирует полный путь и нарушает разделение name/description

**Файл:** `src/webview/main.ts:543-548`, `src/webview/main.ts:591-597`

Путь уже связан с `.folder-head` как стабильный `aria-describedby` через tooltip, но `updateFolderAria` повторно вставляет `Путь: ...` в `aria-label`. Канон требует обратное: accessible name содержит имя и видимые current/missing/date-состояния, а полный путь является description (`ТЗ:68`). Screen reader получает путь дважды, и имя кнопки разрастается до 32 767 символов.

Тест `tests/component/webviewMain.test.ts:347-351` ошибочно закрепляет наличие path в `aria-label`, поэтому зелёный suite доказывает расхождение, а не требование. Аналогично info-кнопка имеет короткое имя `О списке папок Kilo` (`src/webview/main.ts:413`) при обязательном manual contract, где доступное имя соответствует полному пояснению (`M-A11Y-01`).

### Medium — Escape не закрывает tooltip, открытый только мышью

**Файл:** `src/webview/tooltip.ts:167-177`, `src/webview/tooltip.ts:198-205`

Обработчик Escape установлен только на `.hub`. При обычном hover без focus, особенно у пассивного title, keyboard event направляется текущему focused element/body и не обязан всплывать через `.hub`. Поэтому видимый tooltip может не получить Escape. Текущий тест отправляет Escape самому owner после одновременных hover и focus (`tests/component/tooltip.test.ts:173-176`) и не покрывает mouse-only сценарий.

Это расходится с единым правилом УТЗ-05 и `TIP-01`: Escape должен закрывать любой текущий popup, включая pointer-tooltip пассивного диалога.

### Medium — удаление focused folder оставляет focus без безопасного видимого назначения

**Файл:** `src/webview/main.ts:658-673`, `src/webview/main.ts:675-713`

При refresh `focusKey` сохраняется, затем удалённая карточка вместе с focused header/action удаляется. `restoreFocus` ищет только прежний exact key и молча завершается, если folder исчезла. Fallback на соседнюю плашку, refresh или иной видимый безопасный элемент отсутствует.

Это нарушает `ТЗ:145`, план M4 и `M-ACC-07`: существующий focus должен сохраняться, а удалённый target — безопасно сбрасываться. Component test покрывает только сохранение существующей папки, но не удаление focused folder.

### Medium — live region охватывает всё приложение вместо одного status

**Файл:** `src/webviewHtml.ts:30-32`, `src/webview/main.ts:422-427`

`#app` объявлен `aria-live="polite"`, а внутри дополнительно создан отдельный `role="status" aria-live="polite"`. Любое массовое обновление карточек, действий и диалогов становится изменением внешнего live region и может объявляться вместе с точным status, особенно на initial load/refresh.

Это противоречит `M-A11Y-10`, требующему объявлять состояние без чрезмерного повтора. Достаточная специализированная live region уже существует в `.view-status`; component tests не моделируют accessibility announcements.

### Medium — focus outline плашки обрезается самой карточкой

**Файл:** `src/webview/styles.css:128-135`, `src/webview/styles.css:355-358`

Карточка задаёт `overflow: clip`, а общий `:focus-visible` рисует outline с `outline-offset: 2px`. Для `.folder-head`, совпадающей с верхней и боковыми границами карточки, внешняя часть focus ring выходит за clip edge и обрезается. В утверждённом reference такого clip у карточки нет.

Это нарушает требования о видимом focus (`ТЗ:58`, `FOCUS-01`, `M-A11Y-03/07`) и особенно опасно в high-contrast/200% zoom. Happy DOM tests не загружают production CSS и не могут обнаружить clipping.

### Medium — browser→host protocol скрыто расширен сообщением `ready`

**Файлы:** `src/webviewProtocol.ts:40-61`, `src/webviewProtocol.ts:260-278`, `src/kiloHubWebviewProvider.ts:134-145`, `src/webview/main.ts:791-799`

Нормативный protocol разрешает только `refresh` и три folder action (`ТЗ:144`, `PROTO-02`, план M3:138). Реализация добавляет четвёртый тип `ready`, делает его обязательным для `browserReady` и initial synchronization и отдельно принимает в validator. Обычный нормативный initial `refresh` способен запустить чтение, но state не публикуется, пока не пришёл ненормативный `ready`.

Это не пользовательская функция и не непосредственная уязвимость, но является скрытым изменением утверждённого protocol/scope. Собственные tests намеренно принимают `ready` и тем самым закрепляют расхождение вместо проверки нормативного allow-list (`tests/unit/webviewProtocol.test.ts:46-73`).

### Low — открытый tooltip не перепозиционируется при смене темы

**Файл:** `src/webview/main.ts:731-737`, `src/webview/main.ts:777-789`

Theme observer пересчитывает только palette stylesheet. `TooltipController.reposition()` при этом не вызывается, хотя смена темы может изменить вычисленные шрифт, border и размеры popup. Перепозиционирование произойдёт лишь после отдельного scroll/resize/text update.

Это оставляет незакрытым точный сценарий `M-TIP-08` для live theme change. Theme component test проверяет только изменение текста palette rules и отсутствие host-message, но не открытый tooltip и его координаты.

## Coverage

### Покрыто и подтверждено

- Header: manifest/provider задают native `Kilo Hub`; component test подтверждает единственную DOM-строку `Мои папки с Kilo` и отсутствие `Kilo Folders`.
- Current/missing/actions: presenter ставит current first; DOM test покрывает четыре сочетания и отсутствие actions-контейнера у missing; host отклоняет missing и сохранённый current.
- Dates/sorting/max 3/monogram: unit tests покрывают нормативные границы, DST/leap-day, future/invalid, deterministic sort, fallback title, 1 000 conversations, Unicode graphemes и 16 color slots.
- States/refresh: reducer покрывает loading/empty/refreshing/initial error/refresh error/recovery, сохранение старого snapshot и monotonic revision; browser отключает refresh при busy.
- Tooltip: имеются component tests для stable IDs/ARIA, owner↔popup grace 120 ms, focus, Escape при focused owner, passive title, viewport clamp и overflow.
- Theme: есть только базовая light→dark mutation palette без reload.
- Step 1 invariants: metadata SQL остаётся `session` root/non-archived, тела сообщений не читаются; `readOnly`, `query_only`, WAL, busy timeout, worker heartbeat, schema guard, path safety и fixture immutability сохранены существующими tests. Commit не изменяет adapter/projection/path-safety production-файлы.

### Обязательные пробелы

- Нет browser heartbeat/chunked-render test на большой folder snapshot; имеющийся тест 1 000 conversations не проверяет DOM/event loop.
- Нет action-time current resolver test и race между workspace change и click.
- Нет проверки удаления focused/expanded target с fallback focus.
- Нет mouse-only Escape test для tooltip и нет theme-change reposition открытого popup.
- Нет CSS/computed-style contract tests для 260/320/400, B=13/16/20, 200% zoom, approved action composition, focus clipping и horizontal overflow.
- Нет автоматического contrast evidence для четырёх обязательных built-in theme IDs, high-contrast light/dark и forced colors; текущий theme test использует только искусственные белую/чёрную поверхности.
- Production browser formatter дублирует host date helper, но для него проверены только today→yesterday, invalid и future; полный boundary/DST suite выполняется для другой функции.
- Provider concurrency/dispose/revive/out-of-order lifecycle не покрыт deferred controller tests в объёме gate M3.
- Installed VSIX, NVDA, реальный renderer, точные theme IDs, pixel-level и пользовательская визуальная приёмка этим review не проверялись и не могут считаться пройденными.

## Step 1 invariants

Сохранение read-only/metadata-only backend подтверждено статически и regression suite:

- production SQL читает только семь metadata-полей `session` с `parent_id IS NULL` и `time_archived IS NULL`;
- SQLite открывается `readOnly: true`, затем `PRAGMA query_only = ON`; миграций, собственного storage и чтения message bodies нет;
- worker timeout/resource limit, WAL visibility, busy bound и безопасное закрытие соединения остаются;
- browser DTO не содержит executable URI/command, Webview не получает DB/filesystem API, browser state содержит только version/hash expanded folder/scrollTop;
- три исходных folder action semantics и четыре command ID сохранены; path повторно проходит `stat`/`realpath` перед executor.

Оговорка: эти свойства не закрывают High finding о повторной проверке current непосредственно перед action и High finding о browser-side heartbeat.

## Выполненные проверки

Объект ревью: commit `b324982cedc2527826ffc2d74e54dff984abfeac` (`feat: add Kilo Hub Step 2 webview`). До создания этого отчёта рабочее дерево было чистым.

```text
git diff --check b324982^ b324982     PASS
npm run check-types                   PASS
npm run lint                          PASS
npm run test:unit                     PASS, 54/54
npm run test:component                PASS, 20/20
npm run test:integration              PASS, VS Code 1.105.1, exit 0
verify-final.mjs                      PASS
verify-regressions.mjs                PASS
verify-scale.mjs                      PASS
verify-colors.mjs                     PASS
verify-button-tooltips.mjs            PASS
```

Integration run вывел предупреждение VS Code `Error mutex already exists`, но Extension Host и тест завершились с кодом 0. Reference verifiers подтверждают нормативный макет/offline helpers, а не совпадение production CSS/browser renderer.

Не запускались package/install/manual GUI проверки: они не нужны для воспроизведения перечисленных source findings и не заменяют обязательные M8/M9 gates.

## Verdict

**Изменения запрошены. Commit `b324982` не проходит production requirements review.**

Итог: `Blocker: 0`, `High: 2`, `Medium: 7`, `Low: 1`. Exact header/current/missing/actions/date/monogram/sorting/max-3/states/refresh contracts реализованы в значительной части, а Step 1 read-only invariants сохранены, но release exit невозможен до исправления обоих High, всех Medium либо их доказанного допустимого disposition и targeted re-review. Отдельно остаются обязательные installed/manual theme, tooltip, keyboard, NVDA и pixel-level gates.
