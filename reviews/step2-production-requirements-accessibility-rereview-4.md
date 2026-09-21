# Step 2 — финальный requirements/accessibility source verdict

## Объект и scope

- Объект: commit `30c0d5b3a5cacd642cf5cbd447cbe5478b61b5ae` (`fix: achieve Step 2 source review exit`).
- Проверялся только оставшийся Low из `step2-production-requirements-accessibility-rereview-3.md`: единый history heading `h2` во всех нормативных, production, reference CSS/markup и verifier слоях.
- Вместе с ним повторно проверен связанный контракт: названия диалогов пассивны, не становятся Tab-stop, но сохраняют полный tooltip.
- До создания отчёта working tree был чистым. Код, требования, тесты и остальные документы не изменялись.

## Findings

Новых findings нет.

## Disposition предыдущего Low

**Статус: FIXED.**

| Слой | Evidence |
| --- | --- |
| Production | `src/webview/main.ts:565-571` создаёт `h2.history-title` с текстом «Последние диалоги»; `tests/component/webviewMain.test.ts:401` требует `H2`. |
| Каноническое ТЗ | `req/step2/ТЗ реализации дизайна VSIX.md:29,58,68` задаёт блок «Последние диалоги», пассивность названий и отсутствие dialogue Tab-stop; конфликтующего `h3` нет. Точный heading element нормативно уточнён приложением и матрицей. |
| Размерное приложение | `req/step2/design-size-spec.md:29,59` задаёт типографику и `History h2`. |
| Test matrix | `req/step2/03-test-matrix.md:36,79` явно требует `Последние диалоги` как `h2` после единственного `h1` и связывает контракт с `M-HISTORY-01..02`. |
| Reference generator | `req/step2/variants/build-final.mjs:20` создаёт `<h2 ...>Последние диалоги</h2>` и dialogue `<p data-tip>` без `tabindex`. |
| Generated reference | После повторного `build-final.mjs` `01-monograms.html` содержит 64 history `h2`, не содержит history `h3`; генерация не оставила git diff. |
| Active `panel.css` | `req/step2/variants/panel.css:262-269` стилизует `.history h2`; `.history h3` отсутствует. |
| Active `refinements.css` | `req/step2/variants/refinements.css:62-70` применяет heading geometry к `.history h2`; `.history h3` отсутствует. |
| Active `scale.css` | `req/step2/variants/scale.css:106-122` применяет нормативные font/line-height/margin/weight к `.panel .history h2`; `.history h3` отсутствует. |
| Verifier | `req/step2/variants/verify-regressions.mjs:27-28` требует ровно 64 generated history `h2`, запрещает generated history `h3`, требует `.history h2` и запрещает `.history h3` во всех трёх active CSS-файлах. |

Предыдущий false-green устранён: stale CSS selector теперь ломает `verify-regressions.mjs`, а не проходит незамеченным.

## Пассивные диалоги и tooltip

Контракт сохранён:

- canonical запрещает отдельные роль кнопки и Tab-stop, но допускает pointer-tooltip полного title (`ТЗ реализации дизайна VSIX.md:29,68`);
- generator и generated HTML используют `.dialogue[data-tip]` без `tabindex`;
- `verify-regressions.mjs:27` запрещает dialogue `tabindex` и требует `data-tip`;
- `verify-button-tooltips.mjs:47-49` проверяет каждый dialogue: `tabindex` отсутствует, tooltip text равен полному title;
- production регистрирует hover-tooltip с `{ focusable: false }`, сохраняет полный sr-only title и не добавляет conversation role/Tab-stop (`src/webview/main.ts:613-624`);
- component test подтверждает отсутствие `tabindex` и роли, наличие одного полного sr-only title и history `H2` (`tests/component/webviewMain.test.ts:394-401`).

Итог: диалоги пассивны и исключены из Tab-порядка; tooltip и постоянное доступное полное имя сохранены.

## Выполненные проверки

Среда: Windows, Node.js `v24.13.0`, npm `11.6.2`.

```text
git diff --check 928e246 30c0d5b                   PASS
node req/step2/variants/build-final.mjs             PASS, no diff
node req/step2/variants/verify-final.mjs             PASS
node req/step2/variants/verify-regressions.mjs       PASS
node req/step2/variants/verify-scale.mjs             PASS
node req/step2/variants/verify-colors.mjs            PASS
node req/step2/variants/verify-button-tooltips.mjs   PASS
npm run test:component                               PASS, 29/29
git status --short                                   clean before report
```

Пять verifier scripts вместе с generator составляют шесть обязательных design-команд из `req/step2/START_HERE.md:16-23`.

## Counts и source exit

- Проверяемый предыдущий Low: `1 fixed / 0 open`.
- Новые findings: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`.
- Общий открытый итог requirements/accessibility source review: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`.
- Requirements/accessibility source exit: **ДОСТИГНУТ**.

**Вердикт:** production, нормативные документы, test matrix, generator, generated reference markup, все три active CSS-слоя и verifier согласованы на `History h2`. Пассивные dialogue titles не входят в Tab-порядок, tooltip сохранён. Этот узкий requirements/accessibility source gate закрыт; package/install/manual gates данным verdict не оцениваются и не объявляются пройденными.
