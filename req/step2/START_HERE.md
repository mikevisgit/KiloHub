# Step 2 — начинать здесь

Окончательно выбран дизайн **Монограммы**. Активный пакет готов как вход для реализации Step 2; production Webview и устанавливаемый VSIX этим этапом ещё не реализованы.

Последнее приоритетное решение: **УТЗ-10**. Остаётся только fullpath-tooltip по hover текста `.folder-name`, не всей `.folder-head`; focus не показывает popup, полный path доступен через постоянный `aria-describedby` кнопки head. Все прочие tooltip удалены, `pointer-events:none` и geometry dismissal УТЗ-09 сохранены. Текущий package gate **0.2.3** включает PNG `resources/kilo-hub.png` для страницы расширения и неизменённый `resources/hub.svg` Activity Bar.

1. Прочитать [каноническое ТЗ](ТЗ%20реализации%20дизайна%20VSIX.md). Оно содержит базовые UX-решения дизайна.
2. Прочитать [Уточнение ТЗ](02-уточнение-ТЗ.md). Последние принятые решения в нём имеют приоритет над противоречащими формулировками канонического ТЗ.
3. Прочитать нормативное [размерное приложение](design-size-spec.md). Оно уточняет геометрию, не создаёт альтернативных требований.
4. Прочитать [матрицу тестирования](03-test-matrix.md) и [ручной checklist](04-manual-acceptance-checklist.md). Они определяют evidence и release gate, но не объявляют будущую production-реализацию готовой.
5. Посмотреть [галерею](variants/index.html) и [макет монограмм](variants/01-monograms.html): original/dark/light/high contrast, по16папок в каждой теме. Это один дизайн, не варианты на выбор.
6. Перед реализацией прочитать [agents](../../agents.md), [план](../../specs/step1-implementation-plan.md), [handoff](../../handoff.md) и [нормативный Step 1](../step1/01-requirements.md). Сохранить модель данных/read-only/metadata; визуальные изменения Step 2 заданы каноническим ТЗ и его уточнением.

## Сборка и проверка локального макета

Из корня проекта, без установки зависимостей:

```powershell
node req/step2/variants/build-final.mjs
node req/step2/variants/verify-final.mjs
node req/step2/variants/verify-regressions.mjs
node req/step2/variants/verify-scale.mjs
node req/step2/variants/verify-colors.mjs
node req/step2/variants/verify-button-tooltips.mjs
```

Генератор создаёт только index.html и01-monograms.html. Открывать их локально вручную, сервер не нужен. Макет не вызывает команды VS Code и не читает Kilo. Demo-themes.css — только демонстрационные палитры; реальный Webview получает --vscode-* от редактора. Остальные CSS/JS рядом — действующие зависимости макета и офлайн-проверок.

Макеты и их проверки этим обновлением не изменяются и не доказывают соответствие УТЗ-10. При расхождении tooltip-поведения использовать УТЗ-10, канон, size spec, matrix и manual checklist, а не прежний demo-контракт.

## Evidence и границы

В screenshots оставлены3реальных baseline Step1: image.png, image2.png и kilo-hub-step1-scale-reference.png. Они показывают исходный функционал/масштаб, а не целевой дизайн. Старые задания, рабочие UX-черновики, отменённый дизайн и imagegen-пример перемещены в old_donotuse. **Не использовать архив как требования или зависимости Step 2.** Его HTML — исторический исходник, не поддерживаемая запускаемая сборка.

Проверки макета — структурные/арифметические/офлайн JS. Браузерная визуальная и клавиатурная приёмка, реальная анимация/прокрутка/темы, Webview-интеграция и VSIX install/E2E остаются этапами реализации. Tooltip не может рисоваться поверх соседнего UI VS Code, поэтому доступный reference ограничивает popup viewport самой Webview и переносит его вверх при нехватке места снизу. Это ограничение не требует выбора другого дизайна.
