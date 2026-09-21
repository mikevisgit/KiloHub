# План Step 3

Scope: `req/step3/01-requirements.md`; приёмка: `req/step3/02-acceptance.md`. Порядок обязателен, gate нельзя пропускать.

## A. Discovery

- [x] По решению пользователя актуализировать `agents.md` до фиксации нормативного пакета: Step 3 scope, read-only Kilo, ограниченный user-text runtime после Gate A, синтетический discovery.
- [x] Зафиксировать правила и нормативный пакет отдельным commit до дальнейшего исследования: `3bced9a`.
- [x] Записать решения пользователя в ТЗ.
- [x] Сохранить предварительное source evidence в `docs/step3-discovery.md`.
- [ ] Подтвердить schema/projection/change tracking синтетическими fixtures без чтения личной переписки.
- [ ] Измерить поиск подстрок/коротких запросов и runtime minimum/current VS Code.
- [ ] Проверить storage scope, writer/activation/source identity/recovery и установить измеряемые budgets/SLA свежести.
- [ ] Согласовать итоговый стек с пользователем и записать решение.

Gate A: доказательства и ограничения записаны, механизм сверки и бюджеты определены, стек согласован. Наличие event_sequence не объявляется гарантией полного журнала.

## B. Собственная база и синхронизация

- [ ] Развести read-only source и writable Hub storage, guards/migrations и worker lifecycle.
- [ ] Initial import всей допустимой истории порциями с durable progress.
- [ ] Изменения, reconciliation, delete/archive, retry/backoff, source replacement.
- [ ] Multi-window writer, crash recovery, rebuild и privacy-safe Output.
- [ ] Подключить список к Hub projection; заменить Refresh автоматическим обновлением.
- [ ] Проверить DB/SYNC/SEC и провести независимое review до поиска.

Gate B: индекс достоверен и восстанавливаем; источник не изменяется; last-good сохранён при сбоях; фон работает без открытой панели и системного Node.

## C. Поиск и UI

- [ ] AND-подстроки по совокупности полей папки и согласованное ранжирование.
- [ ] Поле/Enter/черновик/сброс/empty/partial states, обновление выдачи, revision/cancellation.
- [ ] Плюсик: выбор существующей папки и открытие здесь без ручного реестра.
- [ ] Временная первая карточка текущей папки без истории (OPEN-04/05): отметка, только пояснение внутри, проверенное отсутствие истории, жизненный цикл и переход к обычной карточке без записи фиктивных данных.
- [ ] Info/plus/name-path tooltip и отсутствие остальных popup.
- [ ] UI/accessibility/performance/security tests; обычные три последних диалога без цитат/пометок.

Gate C: матрица поиска и UI пройдена; нет открытия сообщений или чтения вложений.

## D. Выпуск

- [ ] DOC-01–04: написать `docs/extension-description.md`, подключить как README страницы Details, актуализировать manifest description/release notes, проверить exact contents и отображение установленного VSIX.
- [ ] Независимое review, исправления, повторная проверка.
- [ ] Версия, воспроизводимый VSIX, exact/negative verification, installed minimum/current.
- [ ] Индексация/поиск без Node/npm в системе.
- [ ] Evidence/commit/path/hash/размер/ограничения в handoff и пользовательская визуальная приёмка.

Статус: A частично выполнен (исследование исходников); B–D не начаты. Production `0.2.3` в рамках подготовки ТЗ не изменяется.
