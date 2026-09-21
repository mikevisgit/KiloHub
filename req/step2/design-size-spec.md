# Размерная спецификация Step 2 — Монограммы

Нормативное приложение к [каноническому ТЗ](ТЗ%20реализации%20дизайна%20VSIX.md) с учётом более приоритетного [Уточнения ТЗ](02-уточнение-ТЗ.md). Описывает выбранный дизайн в4темах. Источники в порядке каскада: [demo-themes.css](variants/demo-themes.css), [panel.css](variants/panel.css), [refinements.css](variants/refinements.css), [scale.css](variants/scale.css). Локальные `interaction.cjs`/`demo.js` являются синхронизированным behavioral reference доступных tooltip и аккордеона. Это анализ исходников, не измеренный браузерный рендер.

## База и токены

Все px — CSSpx, не пиксели screenshot. `B=var(--vscode-font-size,13px)`, family=`var(--vscode-font-family,'Segoe UI',Arial,sans-serif)`, W=`var(--vscode-font-weight,400)`. Не подменять editor.fontSize. Box-sizing:border-box; h1/h2/h3/p margin0, кроме указанных ниже случаев. Letter-spacing продуктового текста/монограмм normal.

| Токен | Формула | B13 |
| --- | --- | --- |
| secondary S | 12/13B | 12px |
| name N | 16/13B | 16px |
| mono M | 36/13B | 36px |
| row-x X | 12/13B | 12px |
| row-y Y | 11/13B | 11px |
| gap G | 10/13B | 10px |

CSS использует десятичные эквиваленты дробей с погрешностью<0,000001px при B13–20. Фиксированные border/radius/outline/shadow px не умножаются вручную на B; zoom масштабирует их штатно.

## Полная типографика панели

| Элемент | Размер | B13 | Weight | Line-height; B13 |
| --- | --- | --- | --- | --- |
| Мои папки с Kilo | 15/13B | 15px | 600 | 1,3;19,5px |
| Имя папки | N | 16px | 600 | 1,3;20,8px |
| Вы сейчас здесь | S | 12px | 600 | 1,4;16,8px |
| Активность / missing | S | 12px | W | 1,4;16,8px |
| Действия | B | 13px | W | 1,4;18,2px |
| Последние диалоги | B | 13px | 600 | 1,4;18,2px |
| Название диалога | B | 13px | W | 1,55;20,15px |
| Tooltip | B | 13px | W | 1,45;18,85px |
| Demo-status | B | 13px | W | 1,4;18,2px |
| Буквы монограммы | 15/13B | 15px | 700 | 1;15px |
| Chevron / info | B | 13px | W | 1;13px |
| Refresh | 16/13B | 16px | W | 1;16px |

Кнопки наследуют семейство/weight через font:inherit. Путь показывается в tooltip и не имеет собственной строки деталей. Demo-status отсутствует до демонстрационной команды и не добавляется в продукт как постоянное пояснение. Нативный заголовок VS Code `Kilo Hub` находится вне DOM Webview и не имеет размеров в этом приложении.

## Геометрия блоков

| Элемент | Правило | B13 |
| --- | --- | --- |
| Панель Webview | width auto, min-height0, padding-bottom G; height790px только стенд | Низ10px |
| Intro, первая DOM-строка | flex center, padding G X, gap6/13B, min-width0 | V10/H12/gap6px |
| Список | grid, padding3/13B X G, gap G | Верх3/H12/низ10/gap10px |
| Карточка | margin0, min-width0, ширина по grid, высота по содержимому | Не фиксировать |
| Folder-head | flex center, padding Y X, gap G | V11/H12/gap10px |
| Identity | flex1, min-width0 | Остаток ширины |
| Current-label | margin-bottom2/13B | 2px |
| Дата / missing | каждая margin-top3/13B | 3px |
| Монограмма | height M, flex0 0 M, grid center | 36×36px |
| Chevron | flex0 0 1em, text-align center | Колонка13px |
| Info/refresh | min-width/min-height24/13B, padding2/13B, flex-shrink0 | min24×24px, padding2px |
| Detail-wrap | closed height0/overflowhidden/inert; open auto; при движении inline height | По содержимому |
| Detail | padding4/13B X G!important, min-width0 | Верх4/H12/низ10px |
| Actions | grid, gap4/13B | 4px |
| Действие | min-height28/13B, min-width0, padding4/13B 8/13B; flex gap8px | min28px,V4/H8px |
| История | margin-top G,padding-top G,border-top1px | 10/10/1px |
| History h2 | widthfit-content, margin-bottom4/13B | 4px |
| Диалоги | margin0, без row-gap/padding | Шаг20,15px |
| Непустой demo-status | padding G X | V10/H12px |
| Tooltip | padding8/13B X | V8/H12px |

У текущей доступной папки одна второстепенная команда Проводника; у прочих доступных три; у missing контейнера действий нет. `.detail > .history:first-child` имеет margin-top0/padding-top0/border-top0. Не резервировать пространство под отсутствующие кнопки. Фактическая однострочная кнопка B13: max(28,18,2+8+2)=28,2px; перенос увеличивает высоту. Внутренний flex gap8px фиксирован, отдельной иконки действия сейчас нет.

Collapsed height: `2Y+max(M,identityHeight,B)+2*border`. Однострочные имя+дата дают identity=1,3N+3/13B+1,4S; при B13/border1 карточка64,6px. Current добавляет1,4S+2/13B →83,4px. Missing добавляет строку/отступ и нижнюю рамку `.folder-head`. HC border2 добавляет2px к этим примерам. Высота раскрытия/content/переносов не фиксируется. Знак декоративный; область нажатия — вся плашка. Минимум кнопок24/28px не означает44px touch-target.

## Рамки и скругления

| Элемент | Рамка / эффект | Radius |
| --- | --- | --- |
| Панель | 1px hub-border | Не задан |
| Карточка | 1px hub-border; demo-contrast2px | 15px |
| Folder-head | Без общей рамки, missing нижняя1px dashed | Inherit |
| Монограмма | Резерв1px, normal transparent; HC условная цветная граница, missing dashed | 14px |
| Действие | 1px hub-outline | 7px |
| Info/refresh | 1px transparent | Автором не задан; возможен UA-default |
| История | Верхняя1px hub-border при наличии действий | Не задан |
| Tooltip | 1px hub-focus, shadow0 2px 8px #0004 | Не задан |
| Current folder-head | outline1px contrastActive, offset−1; insetshadow2px0 focus | Inherit |
| Focus-visible | outline2px hub-focus, offset2px | По элементу |

Original current имеет shadow:none/прозрачный фон, border карточки#8ab599 и зелёную пометку. Forced-colors использует системные цвета, current-outline2px Highlight; монограмма Canvas/CanvasText. Обычные темы не имеют видимой рамки знака, рамки карточек сохраняются. Все4темы имеют одинаковые размеры кроме контрастной толщины карточки.

## Tooltip и движение

У каждого owner собственный tooltip-узел со стабильными текстом/DOM ID и `role="tooltip"`; одновременно видим не более одного. Узел использует `position:fixed`, z-index20 и скрывается через `hidden`, `tabindex` не получает. Доступный source постоянно ссылается на его ID через неизменяемый `aria-describedby`, созданный до возможного focus. Popup принимает pointer events для hover и прокрутки, но не содержит интерактивных потомков.

Показ по mouse enter и keyboard focus немедленный. Видимость: `!dismissed && (sourceHovered || sourceFocused || popupHovered)`. Между source и popup действует grace120мс; при уходе из обеих областей и потере focus — скрытие после grace. Escape скрывает сразу; `dismissed` сбрасывается только после одновременных `sourceHovered=false`, `popupHovered=false`, `sourceFocused=false`. У `.folder-head` один fullpath-owner; дата/missing без отдельного popup. Пассивные conversation titles не становятся Tab-stop, а их полный текст постоянно присутствует в DOM/accessibility tree.

Предпочтительная точка — `left=owner.left`, `top=owner.bottom`; если снизу места недостаточно, popup переносится над owner. Итоговые координаты clamp по X/Y с отступом8px внутри viewport Webview. `max-width:min(330px,calc(100vw - 16px))`, `max-height:min(360px,calc(100vh - 16px))`, `width:max-content`, `overflow:auto`, `overflow-wrap:anywhere`. Scroll/resize/zoom/изменение текста запускают повторное измерение. Длинный текст читается мышью с прокруткой и клавиатурой через description source; выход за поверхность Webview не требуется.

Аккордеон320мс, reduced motion0. Easing1−(1−p)^3; height от измеренного start до scrollHeight/0, затем auto/0. На каждом кадре scrollTop компенсирует изменение head.top; после перехода минимальная поправка при head выше панели или head.bottom+40px ниже.40px — фиксированный запас начала деталей. Край списка ограничивает компенсацию, быстрые нажатия сохраняют последнее намерение. Закрытые детали inert/aria-hidden.

Панель overflow:auto/overflow-anchor:none/scrollbar-gutter:stable. Имя переносится anywhere, identity min-width0; видимый текст диалога nowrap/overflowhidden/ellipsis, полный текст остаётся в visually-hidden DOM-узле; кнопки переносятся. Ширины260/320/400 и B13/16/20 — сценарии проверки, не фиксированные widths. Zoom не компенсируется inverse-scale. Не уменьшать шрифт ради числа помещающихся карточек.

## Только оболочка локального стенда

Body margin0; review padding23px26px, h1 24px/600 margin15px0 9px, абзац13px/1,6, ссылка12px. Nav flex-wrap/gap14px/margin-top12px/font12px. Внешняя подпись темы13px/600/margin-bottom12px. Grid repeat(auto-fit,minmax(270px,400px)),gap26px/padding26px; example min-width0/scroll-margin20px. При viewport≤380px grid block/padding8px, example margin-bottom22px. Height790px — только стенд, в Webview доступная высота секции. Production Webview не переносит демонстрационную шапку стенда: нативный `Kilo Hub` рисует VS Code, DOM начинается с Intro. Эти величины не фиксируют sidebar и не должны вытеснять Explorer.

## Проверка

Каскад сверяется с исходниками, verify-scale и остальными локальными проверками. Formula/источники не подтверждают renderer, glyph, UA-radius, scrollbar, DPI/zoom screenshot. Размерный документ не вводит новые функции и не заменяет реальную приёмку Webview/VSIX.
