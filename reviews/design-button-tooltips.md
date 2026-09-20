# Подсказки кнопок без перехвата указателя

Явный тип button назначен действиям папки, refresh и info. Tooltip этих кнопок pointer-events:none/tabIndex−1; pointerout скрывает сразу без grace, popup не перехватывает соседние кнопки. Pointerdown переключает модальность, поэтому клик-фокус не удерживает подсказку; Tab-focus удерживает, Escape скрывает без снятия родного фокуса. Текст, размеры и позиционирование прежние.

Путь/плашка, диалоги, дата, missing и заголовок истории остались информационными подсказками с pointer-events:auto/Tabstop/120мс/прокруткой. Переиспользуемый popup сбрасывает режим и aria-describedby при смене владельца; команды и дополнительные элементы в popup не добавлялись.

verify-button-tooltips.mjs вызывает настоящие обработчики installTooltip на офлайн DOM-дубле: immediate leave в popup/наружу, соседняя кнопка, отсутствие Tabstop и декларация пропуска pointer, click-focus против Tab-focus, Escape/aria, фокус между кнопками, long→simple, сохранение long-hover и изоляция панелей. Прежние verify-final/regressions/scale/colors и node --check проходят. Фактический browser hit-testing, живой Tab-порядок и рендер отдельно не проверены. Production/VSIX не менялись.

Независимый reviewer подтвердил собственным многопанельным harness переходы между детьми кнопки/наружу, keyboard-focus→клик той же кнопки безblur, short→long→popup, Escape с синхронным возвратом фокуса, long→button, panel→panel и очистку aria-describedby. Значимых дефектов нет; браузерный рендер не проверялся.
