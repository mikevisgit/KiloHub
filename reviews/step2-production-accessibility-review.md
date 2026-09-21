# Step 2 — независимое accessibility/interaction/theme ревью production-кода

## Findings

### High — синхронный render большого snapshot блокирует keyboard/focus и browser event loop

**Файл:** `src/webview/main.ts:675-713`

`renderState` без единого yield удаляет, создаёт, обновляет и переставляет все карточки. Создание одной карточки синхронно создаёт header, details, три action-кнопки, history, conversations и их tooltip (`src/webview/main.ts:486-553`). Busy-состояние применяется только после завершения этих циклов (`src/webview/main.ts:708-710`).

Это нарушает обязательный chunked-render/heartbeat contract канона и плана M4. Во время большого обновления Webview не может обработать Tab, Escape, focus, scroll или последнее намерение аккордеона; screen reader также получает один крупный DOM mutation burst. Имеющийся тест 1 000 conversations проверяет presenter, а component suite не отправляет большой folder snapshot и не проверяет browser heartbeat.

### High — при удалении сфокусированной папки focus падает на `BODY`

**Файл:** `src/webview/main.ts:658-713`

Перед refresh сохраняется только `data-key` активного элемента. Затем отсутствующая карточка удаляется, а `restoreFocus` молча завершается, если exact key больше не найден. Fallback на следующую видимую плашку, refresh/info или иной предсказуемый элемент отсутствует.

Точечное воспроизведение на production-модулях: focus установлен на action первой раскрытой папки, следующая revision оставляет только вторую папку; после render `document.activeElement.tagName === "BODY"`, semantic key отсутствует. Это нарушает `ТЗ:145`, план M4 и `M-ACC-07`. Component test `tests/component/webviewMain.test.ts:185-224` покрывает только сохранение существующей папки.

### High — focus indicator заголовка карточки обрезается `overflow: clip`

**Файл:** `src/webview/styles.css:128-149`, `src/webview/styles.css:355-358`

`.folder` создаёт clip edge, а занимающая всю ширину `.folder-head` получает внешний `2px` outline с положительным `outline-offset: 2px`. Для свёрнутой карточки ring выходит за границы предка со всех сторон и обрезается; для раскрытой минимум верхняя и боковые стороны остаются за clip edge. У обычной нетекущей карточки нет альтернативного внутреннего focus indicator.

Это нарушает видимый focus из `ТЗ:58`, `FOCUS-01`, `M-A11Y-03/07` и особенно критично при high contrast/200% zoom. Happy DOM не загружает production CSS и не доказывает видимость ring. Нужен внутренний indicator либо clipping, не уничтожающий focus, после чего требуется реальный Chromium/forced-colors прогон.

### Medium — `Escape` не закрывает tooltip, открытый только наведением

**Файл:** `src/webview/tooltip.ts:167-177`, `src/webview/tooltip.ts:198-205`

Обработчик `keydown` установлен только на `.hub`. Если tooltip открыт hover без focus, особенно у пассивного conversation title, keyboard event направляется текущему focused element или `body` и не всплывает через `.hub`.

Точечный production-repro открыл hover-only tooltip при focus вне панели, отправил `Escape` на `body` и получил `visibleAfterBodyEscape: true`. Тест `tests/component/tooltip.test.ts:164-189` отправляет Escape самому owner после `focusin`, поэтому не покрывает требование WCAG 1.4.13 Dismissible и УТЗ-05 для mouse-only состояния. Глобальный обработчик должен иметь симметричный disposal и не менять focus source.

### Medium — скрытый popup может самопроизвольно появиться снова из устаревшего `popupHovered`

**Файл:** `src/webview/tooltip.ts:353-367`, `src/webview/tooltip.ts:389-404`, `src/webview/tooltip.ts:447-451`

При активации другого owner `#hideVisible` скрывает предыдущий popup, но не сбрасывает его `popupHovered`. Скрытие элемента под указателем не гарантирует последующий `pointerout`. Когда новый keyboard-focused tooltip закрывается, `#showMostRecentInteractingEntry` считает старый скрытый popup всё ещё активным и показывает его без нового hover/focus.

Точечный repro `popup A hover → focus B → blur B` дал `aGhostVisible: true`. Текущие tests проверяют owner-to-owner pointer transition, но не cross-modality `popup hover → другой owner focus`. Это нарушает атомарную смену текущего owner и правило `dismissed/sourceHovered/sourceFocused/popupHovered` УТЗ-05.

### Medium — accessible name плашки дублирует path, а info-name не соответствует точному contract

**Файл:** `src/webview/main.ts:410-414`, `src/webview/main.ts:543-548`, `src/webview/main.ts:591-597`

`.folder-head` уже постоянно связан с tooltip полного пути через `aria-describedby`, но `updateFolderAria` повторно включает `Путь: ...` в `aria-label`. Канон требует name из имени и видимых current/missing/date-состояний, а полный путь — отдельным description (`ТЗ:68`). NVDA получает длинный путь дважды, и основные состояния объявляются после него.

Component test `tests/component/webviewMain.test.ts:347-351` закрепляет ошибочное наличие path в `aria-label`. Дополнительно info-кнопка названа `О списке папок Kilo`, хотя `M-A11Y-01` требует accessible name, соответствующее полному пояснению `Здесь собраны папки…`; полный текст сейчас доступен только как description tooltip.

### Medium — вложенные live regions могут повторно объявлять весь список

**Файл:** `src/webviewHtml.ts:30-32`, `src/webview/main.ts:422-428`, `src/webview/main.ts:675-713`

Весь `#app` имеет `aria-live="polite"`, а внутри находится специализированный `role="status" aria-live="polite"`. Render меняет карточки, действия, диалоги, `aria-expanded`, busy и текст status внутри внешнего live region. Screen reader может объявлять крупный изменённый список вместе с точным status или повторять сообщение.

Это расходится с `M-A11Y-10` «без чрезмерного повтора». Для load/refresh/error достаточно отдельного `.view-status`; component DOM не моделирует accessibility announcements, поэтому окончательное объявление дополнительно проверяется NVDA вручную.

### Medium — automated gate не проверяет production CSS, размеры, contrast и forced colors

**Файлы:** `tests/component/webviewMain.test.ts:78-109`, `tests/component/webviewMain.test.ts:389-416`, `tests/component/accordion.test.ts:188-286`, `src/webview/styles.css:1-385`

Component harness создаёт DOM напрямую и не подключает `styles.css`. Theme test проверяет только текст сгенерированных monogram rules на искусственных белой/чёрной поверхностях. В tests нет production stylesheet/computed-style contract для B=13/16/20, 260/320/400, horizontal overflow, focus clipping, `@media (forced-colors)`, body/media reduced motion или contrast четырёх обязательных built-in theme IDs. Статический scan тестов нашёл только число `320`; width/scale/forced-colors assertions отсутствуют.

Это не означает автоматически, что все эти сценарии визуально сломаны, но Gate M4, `THEME-01/02` и `SCALE-01` не имеют требуемого automated disposition. Source-contract tests должны дополнять, а не заменять обязательный installed manual gate.

### Low — открытый tooltip не перепозиционируется при live theme change

**Файл:** `src/webview/main.ts:731-737`, `src/webview/main.ts:777-789`, `src/webview/tooltip.ts:179-205`

Theme observer вызывает только `updateTheme`; `TooltipController.reposition()` вызывается на scroll/resize и изменении текста, но не на theme mutation. Изменение theme tokens, border и forced/high-contrast styles может изменить размер popup, оставив старые координаты до следующего внешнего события. Это точный незакрытый сценарий `M-TIP-08`; текущий theme test не открывает tooltip.

### Low — структура headings пропускает уровень `h2`

**Файл:** `src/webview/main.ts:406-420`, `src/webview/main.ts:516-522`

Панель начинается с `h1`, но каждый блок «Последние диалоги» создаётся сразу как focusable `h3`; `h2` в DOM нет. Role и текст доступны, однако screen-reader navigation сообщает неожиданную иерархию. Нужен последовательный heading level либо явно обоснованная document outline; focusability заголовка для tooltip можно сохранить независимо от уровня.

## Component evidence

Подтверждено production component tests:

- native button semantics заголовка папки, `aria-expanded`, стабильный `aria-controls`, `aria-hidden` и `inert` закрытых details;
- не более одной раскрытой папки, повторное закрытие, Enter/Space и последнее намерение A→B→B;
- восстановление focus на header при закрытии details, если focus был внутри;
- арифметическая scroll compensation/clamping с подменённой геометрией и duration 320 ms;
- стабильные tooltip IDs/`aria-describedby`, один видимый popup, owner↔popup grace 120 ms, focus удержание, safe `textContent`, viewport clamp и overflow;
- отсутствие Tab-stop/роли кнопки у conversation title и ровно один sr-only полный title;
- точная current/missing priority: у available non-current три actions, у current только Explorer, у missing/current+missing нет actions-контейнера; current label не объявляется для missing;
- сохранение expanded/focus/scroll для существующей keyed folder;
- light→dark пересчёт monogram palette без host message;
- controller disposal снимает accordion/tooltip listeners, отменяет rAF/timer; статический проход подтвердил парные `add/removeEventListener`, `MutationObserver.disconnect()` и media-query cleanup в `main.ts:800-815`.

Зелёный DOM/component suite не является доказательством реальной layout-геометрии, browser hit-testing, accessibility tree конкретной версии Chromium или объявлений NVDA.

## Required manual evidence

На установленном VSIX одного commit/hash остаются обязательными и этим source review не выполнены:

- NVDA: имена/роли/expanded/busy/current/missing, duplicate folder names, отсутствие двойных path/status announcements;
- keyboard-only Tab order, видимый focus и focus recovery при refresh/removal;
- tooltip hover/focus/popup/Escape, hit-testing, scroll длинного текста, края viewport, scroll/resize/theme/zoom;
- accordion normal 320 ms, быстрые reversals, reduced motion, середина/начало/конец длинного списка и реальная scroll compensation;
- ширины 260/320/400 CSSpx при zoom 100/200%, Windows scaling, отсутствие horizontal scroll и перекрытий;
- четыре точных built-in theme IDs, live switch, contrast текста/focus/borders/monograms, dark/light high contrast и Windows forced colors;
- representative custom dark/light themes как best effort.

Ручной результат не должен закрывать воспроизводимые source findings выше; сначала нужны исправления и targeted component re-review.

## Выполненные проверки

Объект ревью: commit `b324982cedc2527826ffc2d74e54dff984abfeac` (`feat: add Kilo Hub Step 2 webview`). VSIX/package/manual GUI не проверялись. До создания отчёта tracked tree был чистым. Среда: Node.js `v24.13.0`, npm `11.6.2`.

```text
git diff --check b324982^ b324982     PASS
npm run check-types                   PASS
npm run lint                          PASS
npm run test:component                PASS, 20/20
npm test                              PASS
  unit                                PASS, 54/54
  component                           PASS, 20/20
  integration                         PASS, VS Code 1.105.1, exit 0
git grep accessibility/security APIs  PASS, raw HTML/eval не найдены
targeted hover-only Escape repro       FAIL as expected: visibleAfterBodyEscape=true
targeted removed-focus repro           FAIL as expected: activeElement=BODY
targeted stale popup-hover repro       FAIL as expected: aGhostVisible=true
```

Integration run вывел `Error mutex already exists`, но Extension Host завершился с кодом 0. Отдельный вспомогательный line-reference scan не запустился из-за отсутствующего `rg` в `PATH`; выводы и ссылки получены чтением исходников и успешным `git grep`.

## Verdict

**Изменения запрошены. Commit `b324982` не проходит accessibility/interaction/theme review.**

Итог: `Blocker: 0`, `High: 3`, `Medium: 5`, `Low: 2`. Current/missing priority, базовые accordion semantics, inert/ARIA, reduced-motion predicate, tooltip grace и listener disposal в значительной части реализованы, но release exit невозможен до исправления High, disposition всех Medium/Low, targeted component re-review и обязательного installed manual evidence.
