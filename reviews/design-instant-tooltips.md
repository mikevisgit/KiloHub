# Все tooltip: наведение только на источник

До правки реальными обработчиками воспроизведено: после owner→popup полного пути подсказка оставалась hidden=false и pointer-events:auto. Последующее уточнение пользователя «как и везде» распространило исправление на все подсказки без исключений.

Теперь один режим: pointer-events:none/tabIndex−1, немедленное скрытие при выходе с owner, без onTip/таймеров120мс/фокуса/типовых data-tip-kind. Потомки одного owner не перезапускают показ. Переход к следующему источнику обновляет владельца и aria-describedby, Escape скрывает. У длинного текста width:max-content/max-width330px и auto-height/visible overflow: интерактивной прокрутки нет. Viewport-clamp не возвращён.

После правки verify-button-tooltips проверяет одинаковое поведение прежних button/path/informational типов, уход на popup/наружу/следующий owner, отсутствие таймеров/Tabstop/focus, стабильность6потомков, Escape и изоляцию панелей. Verify-final/regressions/scale/colors проходят. Все7тем используют общий модуль. Это офлайн доказательства, не browser hit-testing/рендер. Длинный popup может выходить/обрезаться за поверхностью Webview; принятое ограничение записано в ТЗ. Production/VSIX не менялись.
