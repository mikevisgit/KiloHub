# Step 2 — финальное узкое requirements/accessibility source-exit ревью

## Объект и scope

- Объект: commit `928e24687763a251d31a86bbb67c7dd9b9f3910b` (`fix: close final Step 2 source findings`).
- Проверялся только предыдущий Low о полной синхронизации history heading `h2` и непосредственно связанный контракт пассивных диалогов с tooltip.
- Проверены production source, размерная спецификация, test matrix, reference generator, generated HTML, активные CSS reference и verifiers.
- До создания отчёта working tree был чистым. Никакие файлы, кроме этого отчёта, не изменялись.

## Finding

### Low — verifiers пропускают оставшиеся `.history h3` в активном reference CSS

**Файлы:** `req/step2/variants/refinements.css:1`, `req/step2/variants/scale.css:31`, `req/step2/variants/verify-final.mjs:9-24`, `req/step2/variants/verify-scale.mjs:2-16`, `req/step2/variants/verify-regressions.mjs:27`

Основная семантическая цепочка исправлена:

- production создаёт history title как `h2`: `src/webview/main.ts:565-568`;
- размерная спецификация задаёт `History h2`: `req/step2/design-size-spec.md:59`;
- test matrix явно требует `Последние диалоги` как `h2` после единственного `h1`: `req/step2/03-test-matrix.md:36`;
- reference generator создаёт `<h2 ...>Последние диалоги</h2>`: `req/step2/variants/build-final.mjs:20`;
- regenerated `01-monograms.html` содержит history `h2` во всех 64 карточках и не содержит history `h3`;
- production component test требует `H2`: `tests/component/webviewMain.test.ts:401`.

Однако активные reference styles не синхронизированы с новым элементом:

- `refinements.css` продолжает использовать `.history h3` для `width` и `margin-bottom`;
- `scale.css` продолжает использовать `.panel .history h3` для нормативных font size, line-height, margin и weight.

В результате generated `h2` больше не получает эти утверждённые стили reference-композиции. Все шесть design-команд при этом проходят, потому что `verify-final.mjs`, `verify-scale.mjs` и `verify-regressions.mjs` не утверждают ни наличие history `h2`, ни отсутствие stale `h3` selectors. Значит, заявленная проверка слоя verifiers на `History h2` фактически отсутствует.

**Disposition:** открыт. Нужно заменить активные history selectors на `h2` и добавить verifier assertion для generator/generated HTML/CSS: ожидаемый history `h2`, отсутствие history `h3`, сохранность требуемого style selector. До этого requirements/accessibility source exit не достигнут.

## Пассивные диалоги и tooltip

Связанный контракт подтверждён без finding:

- generator создаёт `<p class="dialogue" data-tip="…">` без `tabindex` (`build-final.mjs:20`);
- generated HTML после повторной сборки сохраняет `data-tip` и не содержит `tabindex` у `.dialogue`;
- `verify-regressions.mjs:27` запрещает dialogue `tabindex` и требует `data-tip`;
- `verify-button-tooltips.mjs:47-49` проверяет каждый dialogue: нет `tabindex`, tooltip text совпадает с полным title;
- production создаёт пассивный conversation без роли/button/Tab-stop, регистрирует hover-tooltip и сохраняет полный sr-only текст (`src/webview/main.ts:613-624`);
- component test подтверждает отсутствие `tabindex`/роли, один полный sr-only title и production `H2` (`tests/component/webviewMain.test.ts:394-401`).

Итог: dialogue остаётся пассивным, но tooltip не потерян.

## Выполненные проверки

Среда: Windows, Node.js `v24.13.0`, npm `11.6.2`.

```text
git diff --check 735f06a 928e246                   PASS
node req/step2/variants/build-final.mjs             PASS
node req/step2/variants/verify-final.mjs             PASS
node req/step2/variants/verify-regressions.mjs       PASS
node req/step2/variants/verify-scale.mjs             PASS
node req/step2/variants/verify-colors.mjs            PASS
node req/step2/variants/verify-button-tooltips.mjs   PASS
npm run test:component                               PASS, 29/29
git status --short                                   clean before report
```

Повторная генерация не оставила diff. Пять verifier scripts вместе с generator составляют шесть обязательных design-команд из `req/step2/START_HERE.md:16-23`.

Зелёный результат verifiers не закрывает найденный Low: текущие проверки не связывают новый `h2` с активными CSS selectors и потому допускают false green.

## Counts и source exit

- Проверяемый предыдущий Low: `0 fixed / 1 open` в полном source/reference/verifier scope.
- Новые отдельные findings: `Blocker 0`, `High 0`, `Medium 0`, `Low 0`.
- Общий открытый итог: `Blocker 0`, `High 0`, `Medium 0`, `Low 1`.
- Requirements/accessibility source exit: **НЕ ДОСТИГНУТ**.

**Вердикт:** production, size spec, test matrix, generator, generated HTML и passive-dialogue tooltip contract согласованы с `h2`; source exit блокирует один остаточный Low — stale `h3` в active reference CSS и отсутствие verifier, способного обнаружить это расхождение.
