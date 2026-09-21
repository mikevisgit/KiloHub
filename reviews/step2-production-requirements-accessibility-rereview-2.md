# Step 2 — финальное targeted requirements/accessibility doc re-review

## Объект и scope

- Объект: commit `735f06afdd34baf89965308d91399beaf918b79b` (`fix: close Step 2 targeted review findings`).
- Проверяемый finding: общий новый Low из `reviews/step2-production-requirements-rereview.md` и `reviews/step2-production-accessibility-rereview.md` — устаревшее обозначение `History h3` при production `h2`.
- Дополнительно выполнен только regression scan утверждённой композиции и ранее исправленных requirements/accessibility дефектов.
- До создания отчёта working tree был чистым. Код, требования, тесты и другие файлы не изменялись.

## Findings

### Low — синхронизация `h2` в нормативном пакете остаётся неполной

**Файлы:** `req/step2/design-size-spec.md:3,59`, `req/step2/03-test-matrix.md:28,71`, `req/step2/variants/build-final.mjs:20`, `req/step2/variants/refinements.css:1`, `req/step2/variants/scale.css:31`, `src/webview/main.ts:565-568`, `tests/component/webviewMain.test.ts:393-400`

Прямое расхождение production и строки размерной спецификации исправлено:

- production создаёт `h1` «Мои папки с Kilo» и `h2` «Последние диалоги»;
- `design-size-spec.md:59` теперь содержит `History h2`;
- component regression требует `tagName === 'H2'` и проходит.

Но требуемая согласованность source/size/test matrix не завершена:

- traceability `PRES-01` в `03-test-matrix.md:71` перечисляет только `one h1, no Kilo Folders` и не фиксирует проверяемый контракт `history h2`;
- размерная спецификация в строке 3 называет `variants/build-final.mjs`, `refinements.css` и `scale.css` источниками reference-каскада, тогда как эти активные reference-файлы продолжают создавать/стилизовать `.history h3`.

Runtime production accessibility исправлена и не регрессировала. Остаток является документально-reference inconsistency и сохраняет риск возврата `h3` при следующей сверке с активным макетом.

**Disposition:** Low остаётся открытым. Для закрытия нужно явно закрепить `history h2` в test matrix и синхронизировать активный reference либо явно вывести его legacy `h3` за пределы нормативных источников. В рамках этого read-only review исправления не выполнялись.

## Regression scan

| Область | Результат | Evidence |
| --- | --- | --- |
| Production heading | Без регрессии | `src/webview/main.ts:456-470,565-571`: единственный `h1`, история `h2`; `tests/component/webviewMain.test.ts:400`: `H2`. |
| Утверждённая композиция | Без регрессии | Actions остаются text-only `.action-label`, `.action-icon` отсутствует; info=`ⓘ`; panel border/bottom padding и action gap `8px` сохранены (`main.ts:460-470,519-532`, `styles.css:50-60,251-269`). Component action-matrix test PASS. |
| Accessible name/description и live region | Без регрессии | Path остаётся только стабильным `aria-describedby`; name содержит имя/current/missing/date; `#app` без live region, единственная `.view-status`; component semantics PASS. |
| Focus/tooltip | Без регрессии | Focus fallback, отсутствие folder clipping, внутренний focus outline, document-level Escape, stale-popup reset и theme reposition сохранены; component focus/tooltip/CSS tests PASS. |
| Chunked render | Без регрессии | Порции по 50, heartbeat до завершения 1000 folders и cancellation новой revision сохранены; оба component regressions PASS. |
| Action-time current/revision/path guard | Без регрессии | Двойной `authorizeFolderAction`, active generation/revision и final guard после path resolution сохранены; minimum integration PASS. |
| Diff production Webview | Без изменений | `git diff --exit-code c5cd72b 735f06a -- src/webview/main.ts src/webview/styles.css src/webview/tooltip.ts src/webviewHtml.ts tests/component/...` — PASS, diff отсутствует. |

## Выполненные проверки

Среда: Windows, Node.js `v24.13.0`, npm `11.6.2`.

```text
git diff --check c5cd72b 735f06a       PASS
npm run test:component                 PASS, 29/29
npm run test:integration:min           PASS, VS Code 1.105.1, exit 0
  bundle                               PASS
  verify:webview-bundle                PASS, 32044 bytes
git diff production Webview files      PASS, no changes
git status --short                     clean before report
```

В integration log было внешнее сообщение Chromium о reset quota database; Extension Host завершился с кодом `0`, тесты Kilo Hub прошли.

Package/installed/manual/NVDA/visual gates не входят в этот узкий doc re-review и не объявляются пройденными.

## Counts и verdict

- Проверяемый новый Low: `0 fixed / 1 open` в полном нормативно-reference scope.
- Новые runtime findings: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`.
- Общий открытый итог этого review: `Blocker 0`, `High 0`, `Medium 0`, `Low 1`.

**Вердикт:** production `h2` и размерная строка исправлены, утверждённая production-композиция и прежние fixes не регрессировали. Финальный doc exit пока не достигнут из-за отсутствия явного `h2` в test matrix и сохраняющегося `h3` в активных reference-источниках размерной спецификации.
