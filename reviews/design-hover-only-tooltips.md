# Подсказки только по наведению мыши

Последнее уточнение UX27 отменяет визуальные подсказки по клавиатурному фокусу для всех типов. Из installTooltip удалены focusin/focusout, focus-пиннинг и modality-tracking; каждый popup tabIndex−1. Кнопки сохраняют pointer-events:none/immediate leave; информационные подсказки — pointer-events:auto/hover grace120мс/мышиную прокрутку. Escape и связь aria-describedby только с видимым владельцем сохранены.

Профильные проверки реальных handlers подтверждают отсутствие focus-listeners, отсутствие popup от Tab, неизменность mouse-owner от клавиатуры, скрытие кнопочного popup по leave и прежний long-hover/cross-panel/Escape. Demo.js, HTML семантика/aria-label/кнопки и CSS focus-outline не менялись: клавиатурная активация Enter/Space и обычных кнопок сохранена исходниками. Это не результат реального клавиатурного E2E.

Прошли verify-button-tooltips, verify-regressions, verify-final, verify-scale, verify-colors и diff-check. Общий interaction.cjs подключён обоими макетами во всех7темах. ТЗ/UX27/размерное приложение обновлены, прежние исторические отчёты сохранены. Браузерный рендер/hit-testing не проверялись; production/VSIX не менялись.
