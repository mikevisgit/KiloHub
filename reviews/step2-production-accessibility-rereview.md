# Step 2 — независимое повторное accessibility/interaction/theme ревью

## Новый finding

### Low — размерная спецификация сохраняет устаревшее обозначение `h3`

**Файлы:** `req/step2/design-size-spec.md:59`, `src/webview/main.ts:565-571`, `tests/component/webviewMain.test.ts:400`

Production-код исправил исходный пропуск уровня заголовка: после единственного `h1` блок «Последние диалоги» создаётся как `h2`, и component test закрепляет этот контракт. Однако нормативное размерное приложение по-прежнему называет тот же элемент `History h3`.

Runtime accessibility на commit `c5cd72b` этому не противоречит, но документация и код расходятся. Это создаёт риск возврата исходного дефекта при следующей реализации или сверке каскада. Disposition нового finding: **открыт; требуется синхронизировать нормативное обозначение с `h2` отдельным изменением документации**.

## Повторная проверка исходных findings

Объект повторного ревью: commit `c5cd72b97a58ef991cf1abc73e7cb27c185d44fe` (`fix: resolve Step 2 production review findings`). Проверялись исходный отчёт `reviews/step2-production-accessibility-review.md`, remediation summary, актуальные `main.ts`, `tooltip.ts`, `accordion.ts`, `styles.css`, Webview HTML, component/unit tests, каноническое ТЗ, размерная спецификация, test matrix, manual checklist и план Step 2.

| № | Исходный finding | Disposition | Evidence повторного ревью |
| ---: | --- | --- | --- |
| 1 | High: синхронный большой render блокирует event loop | **Исправлен** | `main.ts:756-836` вводит порции по 50 folders, `setTimeout(0)` yield, generation cancellation и busy/status до начала DOM-работы. `webviewMain.test.ts:523-583` подтверждает heartbeat на 1 000 folders и отмену устаревшей revision без утечки карточек. |
| 2 | High: удаление сфокусированной папки оставляет focus на `BODY` | **Исправлен** | `main.ts:707-754` сохраняет semantic key, folder ID и прежний порядок; fallback идёт на ту же плашку, ближайшую оставшуюся либо refresh. `webviewMain.test.ts:487-521` проверяет исчезнувшее action, удалённую среднюю папку и пустой список. |
| 3 | High: focus ring плашки обрезается `overflow: clip` | **Исправлен в source-контракте; renderer gate остаётся ручным** | У `.folder` удалён clipping (`styles.css:132-138`), для header задан внутренний outline с `outline-offset: -3px` в normal и forced colors (`styles.css:352-361,373-387`). `stylesContract.test.ts:62-70` запрещает возврат clipping и проверяет focus/forced-colors правила. Реальная видимость при zoom/HC проверяется только на установленном VSIX. |
| 4 | Medium: `Escape` не закрывает hover-only tooltip | **Исправлен** | Listener установлен на `panel.ownerDocument` и симметрично удаляется (`tooltip.ts:198-205,332-345`). `tooltip.test.ts:192-212` открывает пассивный hover-only popup, посылает `Escape` на `body` и отдельно доказывает disposal listener. |
| 5 | Medium: stale `popupHovered` может воскресить старый popup | **Исправлен** | `#hideVisible` сбрасывает `popupHovered` до скрытия (`tooltip.ts:447-452`). Cross-modality regression `popup A → focus B → blur B` находится в `tooltip.test.ts:214-237`; оба popup остаются скрыты. |
| 6 | Medium: name плашки дублирует path; info-name неточен | **Исправлен** | `main.ts:640-646` формирует name только из имени, видимых current/missing и даты. Полный путь остаётся отдельным стабильным description через `aria-describedby` (`tooltip.ts:221-249`). Info получает полное согласованное имя (`main.ts:460-464`). Проверки: `webviewMain.test.ts:166-176,364-401`. |
| 7 | Medium: вложенные live regions повторяют список | **Исправлен в DOM; объявления остаются ручными** | `webviewHtml.ts:40-42` не задаёт live region на `#app`; `main.ts:448,472-477` оставляет единственный специализированный `role=status`/`aria-live=polite`. `webviewMain.test.ts:166-170` подтверждает ровно один live region. Фактические объявления NVDA не моделируются Happy DOM. |
| 8 | Medium: нет CSS/size/contrast/forced-colors automated disposition | **Исправлен в заявленном автоматизируемом scope; фактический layout/contrast остаётся ручным** | Новый `stylesContract.test.ts:21-70` читает production CSS и фиксирует B=13/16/20, 260/320/400, horizontal bounds, отсутствие font shrink, focus, forced colors и reduced motion. `presentation.test.ts:238-259` проверяет adaptive palette и контраст инициалов; `webviewMain.test.ts:428-485` покрывает browser date boundaries/DST. План прямо отделяет source contract от manual geometry/zoom/contrast (`specs/step2-implementation-plan.md:164`). |
| 9 | Low: tooltip не reposition при live theme change | **Исправлен** | `updateTheme()` вызывает `tooltipController.reposition()` (`main.ts:847-854`); observer следит за theme class/style/kind/id и media changes (`main.ts:894-906`). `webviewMain.test.ts:585-638` открывает popup, меняет theme attribute и доказывает новые координаты. |
| 10 | Low: после `h1` использован `h3` без `h2` | **Исправлен в production; документационное расхождение выделено новым Low выше** | `main.ts:565-571` создаёт `h2`; `webviewMain.test.ts:400` закрепляет уровень. В runtime пропуска уровня больше нет. |

Итог по исходному отчёту: исправлены `High 3/3`, `Medium 5/5`, `Low 2/2`; открытых исходных findings нет.

## Дополнительные точечные проверки

- Утверждённая композиция восстановлена: actions состоят только из текстового `.action-label`, `.action-icon` отсутствует (`main.ts:519-532`, `webviewMain.test.ts:256-283`); glyph info равен `ⓘ`; panel border/bottom padding и фиксированный action gap отражены в production CSS.
- Матрица действий сохранена: available non-current — три текстовые команды, current — только Explorer, missing и missing+current — без actions-контейнера. Исправления accessibility не добавили новых action/icon/control.
- Path является единственным tooltip плашки и отдельным description, а date/missing не регистрируются как owners. Conversation title остаётся пассивным и имеет один полный sr-only текст.
- Accordion сохраняет native button semantics, `aria-expanded`/`aria-controls`, `inert`/`aria-hidden`, восстановление focus перед закрытием, последнее намерение, 320 ms и reduced-motion predicate (`accordion.ts`, `accordion.test.ts:89-310`).
- Browser date formatter теперь имеет самостоятельный полный набор границ, склонений, leap day и DST; актуализация выполняется при focus/visibility и локальной полуночи без host refresh.
- CSS source-contract не выдаётся за browser layout evidence: он проверяет декларации и арифметику, а не Chromium geometry, glyph, scrollbar, hit-testing или accessibility tree.

## Manual-only gates

Этим source/component re-review не выполнены и не считаются пройденными следующие обязательные проверки одного установленного VSIX, одного source commit и одного SHA-256:

- NVDA: роли, names/descriptions, expanded/busy/current/missing, одинаковые имена папок, отсутствие двойного path/status announcement и фактическое поведение единственного live region;
- keyboard-only: реальный Tab-порядок, видимый focus без clipping и focus recovery после refresh/removal;
- tooltip в Chromium Webview: hover/focus/popup grace, `Escape`, hit-testing, прокрутка длинного текста, края viewport, scroll/resize/live-theme/zoom reposition;
- accordion: воспринимаемые 320 ms, быстрые reversals, reduced motion и scroll compensation в начале, середине и конце длинного списка;
- ширины 260/320/400 CSSpx, zoom 100/200% и Windows display scaling: отсутствие horizontal scroll, перекрытий и обрезки glyph/focus/tooltip;
- точные встроенные theme IDs `Default Dark Modern`, `Default Light Modern`, `Default High Contrast`, `Default High Contrast Light`: фактические contrast pairs, focus/borders/monograms, live switch и Windows forced colors; custom dark/light — best effort;
- наблюдаемая интерактивность большой fixture и screen-reader mutation behavior при chunked render.

VSIX `0.2.0`, package/hash и installed manual evidence в рамках этого ревью не создавались и не проверялись.

## Выполненные проверки

Среда: Node.js `v24.13.0`, npm `11.6.2`; рабочее дерево перед ревью было чистым.

```text
npm run test:component    PASS, 29/29
npm test                  PASS
  check-types             PASS
  ESLint                  PASS
  unit                    PASS, 57/57
  component               PASS, 29/29
  bundle scan             PASS
  integration             PASS, VS Code 1.105.1, exit 0
```

Integration log содержал внешний timeout регистрации GitHub authentication provider, но test Extension Host завершился с кодом `0`; это не связано с Kilo Hub accessibility path.

## Verdict и счётчики

Targeted production fixes на commit `c5cd72b` подтверждены: воспроизводимые дефекты исходного accessibility review устранены в source/component scope.

- Исходные findings: `Blocker 0`, `High 3 fixed / 0 open`, `Medium 5 fixed / 0 open`, `Low 2 fixed / 0 open`.
- Новые findings: `Blocker 0`, `High 0`, `Medium 0`, `Low 1`.
- Общий открытый итог этого повторного ревью: `Blocker 0`, `High 0`, `Medium 0`, `Low 1`.

Accessibility source re-review не является полным release exit: требуется закрыть новое документационное расхождение и выполнить перечисленные installed manual-only gates на итоговом VSIX/hash.
