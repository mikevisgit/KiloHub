# Step 2 — повторное независимое ревью production-требований

## Объект и границы

- Объект: commit `c5cd72b97a58ef991cf1abc73e7cb27c185d44fe` (`fix: resolve Step 2 production review findings`).
- Исходный отчёт: `reviews/step2-production-requirements-review.md` для commit `b324982cedc2527826ffc2d74e54dff984abfeac`.
- Проверены исходный requirements review, remediation, актуальные нормативные документы Step 2, production source и относящиеся unit/component/integration tests.
- До создания отчёта tracked working tree был чистым. Код, требования, тесты и прочие документы не изменялись.
- Это source-level targeted re-review. VSIX `0.2.0`, installed renderer, NVDA, реальные темы/contrast, GUI-действия и ручной checklist не проверялись и ниже обозначены только как gates.

## Новые findings

### Low — размерное приложение всё ещё называет заголовок истории `h3`

**Файлы:** `req/step2/design-size-spec.md:7,59`, `src/webview/main.ts:565-568`, `tests/component/webviewMain.test.ts:393-400`

Production после accessibility remediation создаёт последовательную структуру `h1` → `h2`, и component test закрепляет `H2`. Однако нормативное размерное приложение по-прежнему содержит строку `History h3`, а в общем reset отдельно перечисляет `h1/h2/h3`. Это не ломает runtime-семантику и не меняет размеры, потому что CSS адресует `.history-title`, но оставляет противоречие между нормативным документом и исправленным production DOM.

**Disposition:** открыт. Требуется синхронизировать название элемента в размерном приложении с принятым `h2`; код менять не требуется.

## Повторная проверка исходных findings

| Исходная severity / finding | Disposition | Проверенное evidence |
| --- | --- | --- |
| **High:** большой snapshot рендерился синхронно без browser heartbeat | **Исправлен** | `src/webview/main.ts:86,756-824,826-837` вводит порог, `setTimeout(0)` yield каждые 50 операций, generation cancellation и выставляет status/`aria-busy`/disabled refresh до render. `tests/component/webviewMain.test.ts:523-583` доказывает heartbeat до завершения 1000 folders и отмену старой revision без утечки карточек. Component suite: PASS. |
| **High:** action авторизовался по устаревшему опубликованному `current` | **Исправлен** | `src/kiloHubWebviewProvider.ts:337-406` перед действием заново получает workspace descriptor, проверяет active generation/revision и вычисляет current по host snapshot. `src/kiloHubWebviewProvider.ts:347-355` и `src/commands.ts:91-121` выполняют второй guard после свежего `stat`/`realpath` и непосредственно перед VS Code API. `tests/integration/index.ts:228-281` покрывает stale revision, current race, revision race и смену current перед final guard. Integration VS Code `1.105.1`: PASS. |
| **Medium:** composition отличалась action icons, знаком info, spacing и рамкой панели | **Исправлен** | `src/webview/main.ts:97-117,456-470,519-532` оставляет текстовые actions без icon-узлов и использует `ⓘ`; `src/webview/styles.css:50-60,251-269` возвращает panel border/padding и фиксированный action gap `8px`. `tests/component/webviewMain.test.ts:166-177,256-308` и `tests/component/stylesContract.test.ts:62-70` закрепляют DOM/CSS contract. |
| **Medium:** path дублировался в accessible name вместо description | **Исправлен** | `src/webview/main.ts:592-597,640-646` оставляет путь только в стабильном tooltip/`aria-describedby`, а `aria-label` формирует из имени, видимых current/missing и даты. Info получает полное нормативное accessible name в `src/webview/main.ts:460-464`. Проверки: `tests/component/webviewMain.test.ts:364-401`. |
| **Medium:** Escape не закрывал tooltip, открытый только мышью | **Исправлен** | `src/webview/tooltip.ts:167-177,198-205,332-345` слушает `keydown` на `ownerDocument` и симметрично снимает listener. `tests/component/tooltip.test.ts:192-212` отправляет Escape от `body` для hover-only owner и проверяет disposal. |
| **Medium:** удаление focused folder оставляло focus без назначения | **Исправлен** | `src/webview/main.ts:707-754,775-823` сохраняет semantic focus snapshot и применяет exact → same-folder header → nearest old neighbor → refresh fallback. `tests/component/webviewMain.test.ts:487-521` покрывает удалённое action, удалённую folder и пустой список. |
| **Medium:** весь `#app` был внешней live region поверх отдельного status | **Исправлен** | `src/webviewHtml.ts:40-42` создаёт `#app` без `aria-live`; `src/webview/main.ts:448,472-478` защитно удаляет старый атрибут и оставляет единственный `role=status`/`aria-live=polite`. `tests/component/webviewMain.test.ts:166-170` проверяет ровно одну live region. Реальные объявления NVDA остаются manual gate. |
| **Medium:** focus outline folder head обрезался `overflow: clip` | **Исправлен в source contract** | У `.folder` больше нет clipping (`src/webview/styles.css:132-138`), а header получает внутренний `outline-offset:-3px`, включая forced colors (`src/webview/styles.css:352-361,373-387`). `tests/component/stylesContract.test.ts:62-70` закрепляет отсутствие clip и focus rules. Фактическая видимость при Chromium/HC/200% zoom остаётся manual gate, а не автоматически пройденным результатом. |
| **Medium:** metadata-free `ready` был в production, но не в каноническом allow-list | **Исправлен согласованием контракта** | Канон теперь явно разрешает versioned metadata-free handshake и описывает повторную публикацию snapshot: `req/step2/ТЗ реализации дизайна VSIX.md:144`; матрица — `req/step2/03-test-matrix.md:38-39`; план — `specs/step2-implementation-plan.md:137-145,170-171`. Exact validator находится в `src/webviewProtocol.ts:43-64,288-305`; unit test отклоняет extra fields (`tests/unit/webviewProtocol.test.ts:46-73`); provider/browser handshake проверен в `tests/integration/index.ts:200-226`. |
| **Low:** открытый tooltip не reposition при live theme change | **Исправлен** | `src/webview/main.ts:847-854,894-906` вызывает `tooltipController.reposition()` из theme observer/media handlers. `tests/component/webviewMain.test.ts:585-638` открывает tooltip, меняет theme attribute и проверяет новую координату. |

Итог по исходному Requirements report: **исправлены 10 из 10 findings**. Открытых исходных findings: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`.

## Повторная проверка исходных coverage gaps

| Исходный пробел | Результат повторной проверки |
| --- | --- |
| Browser heartbeat/chunked render | Закрыт component tests на 1000 folders и cancellation новой revision. |
| Action-time current resolver и races | Закрыт provider integration cases, включая final guard после path check. |
| Удаление focused/expanded target | Focus fallback закрыт component test; удалённый expanded ID сбрасывается в `src/webview/main.ts:815-818`. Реальная клавиатура остаётся manual gate. |
| Mouse-only Escape и theme-change reposition | Оба сценария теперь имеют точечные component regressions. |
| CSS/260/320/400/B=13/16/20/focus clipping | Добавлен source-contract suite `tests/component/stylesContract.test.ts`. Это не computed browser geometry; 200% zoom, horizontal overflow и фактическая focus visibility остаются обязательным installed manual gate. |
| Contrast четырёх встроенных тем и forced colors | Source использует semantic tokens и forced-colors rules, но фактический contrast на четырёх точных theme IDs не измерялся этим re-review. Это остаётся gate M9/THEME-01, не PASS. |
| Дублированный browser date formatter | Закрыт отдельным полным browser suite: границы, склонения, future/invalid, DST и leap day в `tests/component/webviewMain.test.ts:406-485`; host formatter также покрыт `tests/unit/presentation.test.ts:41-114`. |
| Provider concurrency/dispose/revive/out-of-order lifecycle | `tests/unit/webviewState.test.ts:152-174` покрывает stale/out-of-order reducer completions; `tests/integration/index.ts:283-351` покрывает coalescing, late post, dispose/revive, stale old view и bounded ready timeout. Integration PASS. |
| Installed VSIX, NVDA, renderer, theme IDs, pixel-level | Не выполнено; остаётся gate M8/M9. Наличие source/tests не считается прохождением этих сценариев. |

## Release gates, не пройденные этим review

- **M7:** этот requirements re-review закрывает исходные Requirements High/Medium/Low, но выявил новый открытый Low по документации; остальные независимые domains должны иметь собственный итог.
- **M8 / VSIX:** `dist/kilo-hub-0.2.0-win32-x64.vsix`, два воспроизводимых package cycle, exact hash, isolated install и minimum/current installed-host evidence отсутствуют в объекте этого review. Статус: **gate pending**, не PASS.
- **M9 / manual:** реальный Chromium layout 260/320/400, zoom 200%, focus, tooltip hit-testing, четыре встроенные темы/contrast, forced colors, NVDA, три GUI actions и пользовательская pixel-level оценка не выполнялись. Статус: **gate pending**, не PASS.
- Старый VSIX `0.1.0` не является evidence Step 2.

## Выполненные проверки

Среда: Windows, Node.js `v24.13.0`, npm `11.6.2`.

```text
git diff --check c5cd72b^ c5cd72b  PASS
npm run check-types                 PASS
npm run test:unit                   PASS, 57/57
npm run test:component              PASS, 29/29
npm run test:integration:min        PASS, VS Code 1.105.1, exit 0
  bundle                            PASS
  verify:webview-bundle             PASS, 32044 bytes
git status --short                  clean before report
```

Package/repro/installed/manual команды намеренно не запускались: текущий план оставляет VSIX `0.2.0` pending до review exit, а их отсутствие нельзя заменить development-host тестом.

## Counts и verdict

- Исходные Requirements findings после re-review: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`; fixed `10/10`.
- Новые findings этого re-review: `Blocker 0`, `High 0`, `Medium 0`, `Low 1`.
- Отдельные незавершённые release gates: `M8 package/install`, `M9 manual/NVDA/visual/theme/GUI`.

**Вердикт:** remediation фактически закрывает все исходные High/Medium/Low requirements findings и профильные date/provider gaps в автоматизируемой части. Полный release verdict пока не достигнут: открыт один новый Low по согласованности нормативного heading label, а VSIX и обязательная ручная приёмка остаются gates без результата.
