# Полная размерная спецификация двух эталонов

**Нормативная часть [финального ТЗ реализации дизайна VSIX](ТЗ%20реализации%20дизайна%20VSIX.md)**. Описывает фактические текущие макеты «Тонкие рамки» и исходные «Монограммы», все семь тематических представлений. Это спецификация по каскаду исходников, не измерение браузерного рендера. Макеты данным документом не изменяются.

Источники в порядке подключения: [demo-themes.css](variants/demo-themes.css) → [panel.css](variants/panel.css) → [refinements.css](variants/refinements.css) → [scale.css](variants/scale.css); inline-размеры tooltip/анимации задают [interaction.cjs](variants/interaction.cjs) и [demo.js](variants/demo.js). Если ранняя декларация перекрыта поздней, ниже указано итоговое значение. Старые `.path`, `.hint`, `.history ul/li/time` не создаются текущим HTML и не являются элементами дизайна.

## Обозначения и общие правила

- Все `px` ниже — CSSpx, не пиксели изображений и не физические пиксели экрана.
- `B = --hub-base = var(--vscode-font-size,13px)`. Семейство: `var(--vscode-font-family,'Segoe UI',Arial,sans-serif)`. `W = var(--vscode-font-weight,400)` — обычное начертание. Не использовать `editor.fontSize` как UI-базу.
- `S = --hub-secondary = (12/13)B`. В CSS коэффициенты записаны десятичными приближениями, например `.9230769231`; дроби в таблицах эквивалентны с погрешностью менее0,000001px при B13–20.
- `X = --hub-row-x`: рамки `(10/13)B`, монограммы `(12/13)B`; `Y = --hub-row-y`: `(8/13)B` / `(11/13)B`; `G = --hub-gap`: `(8/13)B` / `(10/13)B`.
- `N = --hub-name-size`: `(15/13)B` / `(16/13)B`; `M = --hub-mono-size`: `(32/13)B` / `(36/13)B`.
- Везде `box-sizing:border-box`. Числовой line-height умножается на font-size самого элемента. Размер glyph не равен line-height. У h1/h2/h3/p глобально margin0; исключения ниже.
- Семейство наследуется от панели, обычные кнопки используют `font:inherit`, затем получают размеры из scale.css. Letter-spacing имён/меток/монограмм и заголовка списка — `normal`, отрицательные ранние значения перекрыты.

## Типографика: все видимые тексты панели

| Элемент | Font-size: рамки / монограммы | При B13, px | Font-weight | Line-height; при B13, px |
| --- | --- | --- | --- | --- |
| База панели и текст header | B / B | 13 / 13 | W | 1,4; 18,2 |
| `Kilo Hub` в header strong | B / B | 13 / 13 | 600 | 1,4; 18,2 |
| «Мои папки с Kilo» | 14/13B / 15/13B | 14 / 15 | 600 | 1,3; 18,2 / 19,5 |
| Имя папки `.name` | N | 15 / 16 | 600 | 1,3; 19,5 / 20,8 |
| «Вы сейчас здесь» | S | 12 / 12 | W / 600 | 1,4; 16,8 |
| Дата активности | S | 12 / 12 | W | 1,4; 16,8 |
| «Папка не найдена» | S | 12 / 12 | W | 1,4; 16,8 |
| Доступные действия | B | 13 / 13 | W | 1,4; 18,2 |
| «Последние диалоги» | B | 13 / 13 | 600 | 1,4; 18,2 |
| Название каждого диалога | B | 13 / 13 | W | 1,55; 20,15 |
| Tooltip, включая полный путь | B | 13 / 13 | W | 1,45; 18,85 |
| Статус демонстрационной команды | B | 13 / 13 | W | 1,4; 18,2 |
| Буквы монограммы | B / 15/13B | 13 / 15 | 600 / 700 | 1; 13 / 15 |
| Chevron `⌄` | B | 13 / 13 | W | 1; 13 |
| Info `ⓘ` | B | 13 / 13 | W | 1; 13 |
| Refresh `↻` | 16/13B | 16 / 16 | W | 1; 16 |

Статус демонстрации отсутствует до нажатия команды. Он не является дополнительным постоянным пояснением будущего расширения. Полный путь не имеет своей строки в деталях: применяется размер tooltip.

## Геометрия основных блоков

В парных примерах первое значение — рамки, второе — монограммы. Padding указан верх/право/низ/лево, сокращение V/H — вертикаль/горизонталь.

| Блок / свойство | Итоговая формула или правило | Пример B13, px |
| --- | --- | --- |
| Панель | width auto по выделенной области; height790px только у локального стенда; min-height0 | Стенд790; для Webview доступная высота секции, не фиксировать ширину |
| Панель padding | 0 0 G 0 | Низ8 / 10 |
| Header | padding `(6/13)B X`; flex gap G; justify-content space-between, align-items center | V6; H10 / 12; gap8 / 10 |
| Intro | padding G X; flex gap `(6/13)B`; min-width0 | V8 / 10; H10 / 12; gap6 |
| Список `.folders` | grid; padding `(3/13)B X G`; gap G | Верх3; H10 / 12; низ8 / 10; gap8 / 10 |
| Карточка `.folder` | margin0, min-width0; ширина grid-ячейки, высота content-dependent | Нет фиксированной ширины/высоты |
| Нажимаемая плашка `.folder-head` | flex; padding Y X; gap G; align-items center | V8 / 11; H10 / 12; gap8 / 10 |
| Текстовая область `.identity` | flex1, min-width0 | Занимает остаток после знака, chevron и двух gaps |
| Current-пометка | margin-bottom `(2/13)B` | 2 |
| Дата / missing-пометка | каждая margin-top `(3/13)B` | 3 |
| Обёртка деталей | закрыта: height0, overflow hidden, inert; открыта: height auto; при переходе inline height по анимации | Не назначать фиксированную высоту раскрытию |
| `.detail` | padding `(4/13)B X G`, min-width0; правило с `!important` | Верх4; H10 / 12; низ8 / 10 |
| `.actions` | grid, gap `(4/13)B` | 4 между соседними кнопками |
| Кнопка действия | min-width0; min-height `(28/13)B`; padding `(4/13)B (8/13)B`; gap8px внутри flex | min28; V4/H8; внутренний gap8 фиксированный (в текущем HTML нет отдельной иконки) |
| История `.history` | margin-top G; padding-top G; border-top1px | Внешний gap8 / 10, внутренний8 / 10 |
| Заголовок истории | width fit-content; margin-bottom `(4/13)B` | 4 до первого названия |
| Строки диалогов | margin0, дополнительных row-gap/padding нет | Шаг одной строки20,15 при B13 |
| Непустой demo-status | padding G X | V8 / 10; H10 / 12 |
| Пустой demo-status | margin0, padding не задан; пустой p | Нет добавленного текстового блока |

Видимость: доступная текущая папка содержит только второстепенную кнопку Проводника, доступная нетекущая — три команды. У missing контейнер `.actions` отсутствует (даже если current); `.detail > .history:first-child` имеет margin-top0, padding-top0, border-top0. Высота деталей уменьшается по содержимому, место под удалённые кнопки не резервируется. Стили disabled остаются защитными, но в текущем HTML таких кнопок нет.

Кнопка действия растягивается grid по ширине деталей; текст выровнен влево. Фактическая однострочная высота при B13 — `max(28,18,2+4+4+1+1)=28,2px`, а не ровно28px. При переносе увеличивается по содержимому. Панель и карточки не должны получать фиксированную ширину из этого примера.

## Знаки и области нажатия

| Элемент | Геометрия | B13, px | Область взаимодействия |
| --- | --- | --- | --- |
| Монограмма | height M; flex `0 0 M`; border входит в M; grid place-items center | 32×32 / 36×36 | Сам знак декоративный, aria-hidden; активна вся плашка |
| Chevron | flex `0 0 1em` при font-size B; line-height1; text-align center | Колонка13, строка13; glyph зависит от шрифта | Часть общей плашки, отдельной кнопки нет |
| Refresh/info | flex-shrink0; min-width/min-height `(24/13)B`; padding `(2/13)B`; border1px | Минимум24×24, padding2 со всех сторон | Вся кнопка; это минимальная область CSS, не обещание touch-target44px |
| Действие | min-height28/13B, width по grid; padding выше | Минимум28px, фактически≥28,2px для одной строки | Вся кнопка; у missing кнопок нет |
| Название диалога / дата | Content-sized строки с tabindex для tooltip | По строке и доступной ширине | Нет команды открытия/отдельного минимального hit-target |

Высота collapsed-плашки не фиксирована: `2Y + max(M, высота identity, B)`; к карточке добавляются её внешние border. Для обычной одной строки имени + одной даты identity = `1,3N + (3/13)B + 1,4S`. При B13 и border1px: карточка≈57,3px / 64,6px. Current добавляет строку `1,4S` и margin2/13B; получаются≈76,1px / 83,4px. Это арифметические примеры без переноса, не CSS height. Missing дополнительно включает свою строку с margin и border-bottom плашки; длинное имя, zoom и переносы меняют высоту. Раскрытая карточка равна высоте плашки + фактической высоте деталей + внешним border; её точную высоту заранее не фиксировать.

## Рамки, скругления, контуры

| Элемент | Рамки | Radius / дополнительные эффекты |
| --- | --- | --- |
| Панель | 1px solid `--hub-border` | Radius не задан |
| Header | Только нижняя1px solid `--hub-border` | Нет тени |
| Карточка рамок | 1px solid `--hub-border` во всех3темах | Radius4px |
| Карточка монограмм | 1px solid `--hub-border`; в `.demo-contrast`2px | Radius15px во всех4темах |
| Плашка | Отдельной общей рамки нет; missing border-bottom1px dashed | Radius inherit от карточки |
| Монограмма | 1px solid `--hub-outline`; missing dashed | Radius4px / 14px |
| Действие | 1px solid `--hub-outline`; missing1px dashed `--hub-border` | Radius2px / 7px |
| История | border-top1px solid `--hub-border` | Без собственной карточки |
| Info/refresh | 1px solid transparent | Radius не задан авторским CSS: возможен UA-default, точное число не нормативно |
| Current-плашка | Outline1px solid `--vscode-contrastActiveBorder`, offset−1px; inset shadow2px 0 `--vscode-focusBorder` | В оригинальной палитре монограмм shadow:none, фон прозрачный; border карточки цвет#8ab599 |
| Focus-visible | outline2px solid `--hub-focus`, offset2px | Не занимает место в потоке |
| Tooltip | 1px solid `--hub-focus` | Radius не задан; shadow `0 2px 8px #0004` |

`--hub-outline` берётся из `--vscode-contrastBorder` (fallback transparent): прозрачная рамка всё равно занимает1px. Тёмная/светлая/оригинальная палитры не меняют размеры шрифтов или отступов. Единственная дополнительная толщина карточки в семи демо —2px у контрастных монограмм. `forced-colors:active` — отдельный системный режим, не синоним демо-темы: рамки получают ButtonText, current-outline2px Highlight, disabled — GrayText. Контуры фокуса остаются2px; итог системных цветов требует runtime-проверки. Hover/expanded сами по себе толщину рамки и padding не меняют. Все приведённые border/radius/shadow/outline px фиксированы CSS, не умножаются вручную на B; browser zoom масштабирует их штатно.

## Tooltip: путь, заголовки и полные названия

- Одна переиспользуемая подсказка на панель; `position:fixed`, z-index20, border-box; hidden → display:none. Padding `(8/13)B X`: при B13 V8, H10/12px. Font/line-height указаны в типографике.
- CSS fallback max-width `min(330px,100vw−16px)`, max-height `100dvh−16px`. **При показе JS устанавливает inline max-width `max(1,innerWidth−16)px` и max-height `max(1,innerHeight−16)px`: inline заменяет CSS-предел330px.** Поэтому330px нельзя считать действующим максимальным пределом открытой подсказки. Ширина/высота auto по содержимому, ограничены этими максимумами.
- `overflow:auto`, `overscroll-behavior:contain`, `scrollbar-gutter:stable`, white-space normal, overflow-wrap anywhere. Подсказка фокусируема для клавиатурной прокрутки; размер scrollbar зависит от среды, в таблицах он не фиксируется.
- `left=max(8,min(trigger.left,viewportWidth−tooltipWidth−8))`; `top=max(8,min(trigger.bottom,viewportHeight−tooltipHeight−8))`. Положение в CSSpx относительно viewport, а не карточки; минимальные поля8px, зазор над нижним краем trigger не добавляется. При нехватке места подсказка может перекрывать часть владельца. При scroll/resize координата пересчитывается.
- Pointerout grace120мс; focus/hover удерживают подсказку, Escape закрывает её. Это не длительность анимации карточки. Полного пути в потоке деталей нет, отдельные размеры под него не резервировать.

## Переносы, высота секции и движение

Панель `overflow:auto`, `overflow-anchor:none`, `scrollbar-gutter:stable`; собственная ширина гибкая. У identity/name/details/actions min-width0 где задано, имя переносится через overflow-wrap:anywhere; диалог white-space nowrap + overflow hidden + text-overflow ellipsis. Tooltip переносится, кнопки могут переносить текст. Нет фиксированного количества помещающихся карточек. Прокрутка предпочтительнее уменьшения шрифта. Ширины260/320/400px — проверочные сценарии, не фиксированные widths компонентов. Zoom/DPI не компенсировать inverse-scale.

Аккордеон **320мс**, reduced motion **0мс**. Easing в JS `1−(1−p)^3`; height меняется от измеренного текущего значения до scrollHeight либо0, после завершения — auto либо0px. Компенсация scrollTop удерживает верх выбранной плашки по её фактической координате на каждом кадре. После перехода, если плашка выше viewport панели, scrollTop корректируется до её верха; при раскрытии проверяется `head.bottom+40px`, и недостающая часть прокручивается. **40px — текущий фиксированный запас показа начала деталей**, не высота кнопки или новый B-token. Край списка ограничивает компенсацию. Быстрые клики сохраняют последнее намерение; закрытые детали inert/aria-hidden, не входят в Tab-порядок.

## Только оболочка локального сравнения — не размеры VSIX

Чтобы будущий агент не переносил параметры стенда в продукт: body margin0; review padding23px26px, h1 24px/600 с margin15px0 9px, абзац13px/1,6; ссылка12px, navigation gap14px/margin-top12px/font12px. Подпись темы вне панели —13px/600, margin-bottom12px. Theme-grid: колонки `repeat(auto-fit,minmax(270px,400px))`, gap26px, padding26px; theme-example min-width0 и scroll-margin20px. При viewport≤380px grid становится block с padding8px, секции имеют margin-bottom22px. Панель внутри стенда height790px. Эти размеры не фиксируют ширину sidebar или высоту Webview; в реальной интеграции использовать выделенное секции пространство. Внешние подписи галереи не входят в список продуктовой типографики выше.

## Проверка спецификации

Таблицы сверены с порядком stylesheet, специфичностью `.panel`/`.monograms`/`.inset`, media-правилами и JS inline-style. Проверены дробные значения при B13, размеры строк/кнопок и local links. Проверки verify-scale/verify-final подтверждают исходники и арифметику, но не фактические размеры browser layout, glyph, системных scrollbars или UA-radius. Пиксели screenshot и imagegen не использованы как CSSpx. Неуказанные min-height/hit-target/radius не дополняются вымышленными числами.
