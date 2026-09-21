# План Step 3

Scope: `req/step3/01-requirements.md`; приёмка: `req/step3/02-acceptance.md`. Порядок обязателен, gate нельзя пропускать.

## A. Discovery

- [x] По решению пользователя актуализировать `agents.md` до фиксации нормативного пакета: Step 3 scope, read-only Kilo, ограниченный user-text runtime после Gate A, синтетический discovery.
- [x] Зафиксировать правила и нормативный пакет отдельным commit до дальнейшего исследования: `3bced9a`.
- [x] Записать решения пользователя в ТЗ.
- [x] Сохранить предварительное source evidence в `docs/step3-discovery.md`.
- [x] Выполнить первый synthetic discovery цикл: 42 search cases/345 assertions на bundled minimum/current, 9 sync cases на трёх runtime; результаты и ограничения записаны в discovery.
- [x] Выполнить второй цикл: disk/WAL поиск (45 cases/450 oracle comparisons/24 invalid-reset), source ambiguity guard (8 checks), реальные Extension Host startup/profile probes на minimum/current. Scope и ограничения в discovery.
- [x] Выполнить третий цикл: multi-process SQL fencing, OS pipe ownership, extraction реального synthetic JSON с NUL/длинными полями. Evidence в `docs/step3-writer-design.md` и discovery.
- [x] Подтвердить schema/projection/change tracking синтетическими fixtures без чтения личной переписки: DB-06/09 probes, WAL/snapshot/delete/archive/reset.
- [x] Измерить поиск подстрок от 3 символов в каждом токене и runtime minimum/current VS Code; запросы с токенами 1–2 символа отвергать без обращения к индексу.
- [x] Проверить primitives storage scope/writer/activation/source identity/recovery; бюджеты и границы зафиксированы в `docs/step3-resource-policy.md`. Production recovery/lifecycle проверяются в B.
- [x] Согласовать итоговый стек с пользователем и записать решение: 21 сентября 2026 года, SQLite + встроенный node:sqlite + Worker Threads + FTS5 trigram с точным instr. Без молчаливого импорта нового формата; неоднозначный источник обрабатывается как несовместимый по DB-09.

Gate A: доказательства и ограничения записаны, механизм сверки и бюджеты определены, стек согласован. Наличие event_sequence не объявляется гарантией полного журнала.

Согласованный проектный контракт между фазами B/C: база и тексты остаются в worker; host получает только metadata, состояние полноты/ошибки и результаты поиска в виде идентификаторов папок с rank. API фонового сервиса должен публиковать snapshot/revision независимо от открытого Webview. Поисковые ответы привязаны к generation запроса и revision индекса; пересылка реплик в Webview запрещена. Точный TypeScript API закрепляется при реализации B, а не подменяется чтением полного корпуса в host.

Обязательные integration invariants B: provider.refresh() не используется как scheduler, поскольку старый метод раскрывает Webview. Health/completeness сохраняются при пересчёте текущей папки. Публикация metadata и domain references атомарна и защищена generation после await; старый final action guard инвалидируется новым snapshot. Ограничения старого metadata reader не являются пределом индекса, а предел одного DTO не должен усекать весь пользовательский корпус. Диагностика text importer передаётся allow-listed кодами без raw exception/message/stack с текстом. Изменённые требования activation/refresh в тестах заменяются, остальные baseline-инварианты сохраняются.

## B. Собственная база и синхронизация

- [x] Развести read-only source и writable Hub storage, guards/migrations и worker lifecycle.
- [x] Initial import всей допустимой истории порциями с durable progress.
- [x] Изменения, reconciliation, delete/archive, retry/backoff, source replacement.
- [x] Multi-window writer, crash recovery распознанных поколений, rebuild и privacy-safe Output; неизвестный coordination format остаётся fail-closed, не перезаписывается автоматически.
- [x] Подключить список к Hub projection; заменить Refresh автоматическим обновлением.
- [x] Проверить DB/SYNC/SEC и провести независимое review до поиска: 83 unit/29 component/minimum host, дополнительные 10 cases на каждом bundled runtime; 2 High/1 Medium исправлены и перепроверены.

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

Статус: Gate A/B пройдены для начала C. Стек согласован, DB-09 действует; row-scaled admission не является гарантией native memory isolation. Нераспознанные control files fail-closed без разрушительного ремонта. C начинается; окончательные production-scale, installed/no-system-tools и release проверки остаются обязательными в C/D.
