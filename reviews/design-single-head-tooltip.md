# Одна подсказка плашки, позиция без подгонки

Оба макета используют один fullpath-owner .folder-head: имена, инициалы, дата, current/missing и стрелка не имеют вложенных подсказок. Это одинаково для свёрнутого и раскрытого header; actions/history/dialogues в деталях сохраняют собственные подсказки. У активности tooltip удалён и из HTML, и из updateDates. Missing остаётся видимым статусом без отдельного popup.

Tooltip привязан к owner.left/bottom, без viewportclamp/JS max-size. CSS width:max-content/max-width330px/max-height360px не подгоняет ширину под остаток справа. Последнее уточнение устраняет обнаруженный reviewer CSS shrink-to-fit при width:auto. Выход за экран и clipping допустимы по запросу; popup не может выйти за поверхность Webview поверх соседнего редактора. Новая host-поверхность не создавалась.

Проверки112плашек: ровно один owner, точный полный путь, отсутствие date/name/missing data-tip и запрет восстановления date-tooltip при refresh. Реальные handlers на офлайн дубле подтверждают отсутствие переписываний текста/hide/timers между6дочерними зонами и exact left/bottom у края. CSS-инвариант width:max-content сохранён. Все5verify и node --check проходят; цвета/320мс/клавиатурная активация/мышиные режимы остальных подсказок сохранены. Browser runtime/рендер не проверен.
