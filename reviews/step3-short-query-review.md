# Ревью исправления поиска0.3.1

Независимое read-only review: подтверждённых ошибок в parser, search planner, предупреждении и регрессиях не найдено. Минимум применяется ко всему нормализованному запросу, короткие слова сохраняются, длинные проверяются первыми. Literal instr для коротких/NUL ограничен предыдущими кандидатами через связанный JSON; AND/ранги не меняются.

Повторные слова сохранены в normalized query, а tokens дедуплицированы, поэтому «a a» стабильно проходит browser/host/worker проверки. Изменений схемы/синхронизации нет. Manifest/lock/verifier/integration согласованы на0.3.1.

Targeted28/28 (search+renderer) PASS. Search10/10 на bundled minimum/current PASS. Тестовый fixture сначала ошибочно использовал запрещённое Windows-имя NUL; исправлен на nul-case, production для этого не ослаблялся. Полный package/installed gate и основная переустановка pending.
