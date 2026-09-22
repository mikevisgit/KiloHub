# План Step 3

Scope: `req/step3/01-requirements.md`; приёмка: `req/step3/02-acceptance.md`. Порядок обязателен, gate нельзя пропускать.

Уточнение0.3.2: SEARCH-02 заменён на auto-search после300ms, с немедленным Enter/сбросом, IME и stale-response защитой. Старые формулировки о поиске только по Enter исторические; текущий контракт задан в требованиях. Компонентные проверки38/38 PASS, финальное review/release/install выполняются отдельно.

Выпуск0.3.2 завершён: исправлен P2 приостановленной chunk-отрисовки,39component/112unit в двух release циклах, exact/negative/installed PASS, пакет установлен. Sourcece9fba0, checksum и caveats в docs/step3-verification.md.

Публикация на GitHub: готовится перенос существующей истории в публичный `mikevisgit/KiloHub`. По явному решению пользователя три устаревших изображения из `req/step2/screenshots/` удаляются только из актуального дерева; их присутствие в старых коммитах разрешено после пользовательской проверки. Исторические ссылки на эти baseline-изображения относятся к прежним коммитам. Материалы Step 4 публикуются отдельно в ветке `step4`; production macOS не заявляется. Существующий проверенный VSIX 0.3.2 не пересобирается ради документационных изменений, ручная визуальная/NVDA-приёмка остаётся открытой.

После пользовательской проверки0.3.0 уточнён SEARCH-03: три символа для всего запроса, короткие слова не запрещены и не игнорируются. Исправляются общий parser, literal fallback/сужение по длинным токенам, предупреждение и тесты; новая схема/индексация не нужны. Исторические пункты ниже о минимуме каждого токена относятся к исходному выпуску и заменены новым контрактом.

Исправление завершено и выпущено как0.3.1 из39caca5:112unit/35component в каждом из двух clean release циклов, exact/negative/installed gates PASS, пакет установлен в основной VS Code. Source/package review без findings. Evidence/hash в docs/step3-verification.md; ручная визуальная приёмка отдельно.

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

Уточнение пользователя 22 сентября: перед выпуском выполнить DB-10/SYNC-08. Не оптимизировать первоначальный импорт ради времени 259 s и не менять пакетирование как самостоятельную задачу. Убрать quick_check с горячего пути; обычные обновления по диалогам, сверка различий, сохранение прогресса/поиск готовой части при изменяющемся источнике. Проверки соответствующих B/C-инвариантов повторить, прежние результаты не покрывают этот новый контракт.

- [x] DB-10: кэш проверки целостности с invalidation без ослабления source guards; 7/7 на обоих bundled runtime.
- [x] SYNC-08: инкрементальные изменения/сверка различий, сохранение прогресса, поиск готовой части при incomplete; durable schema3 очередь, атомарная замена диалога.
- [x] Регрессии нового контракта и независимое review: исправлены census transaction regression и restart publication Medium. 110 unit + отдельно10001-session case, 34 component, minimum/current host PASS. Единый финальный npm test не заявляется; подробности в reviews/step3-sync-refinement-review.md.

- [x] AND-подстроки по совокупности полей папки и согласованное ранжирование.
- [x] Поле/Enter/черновик/сброс/empty/partial states, обновление выдачи, revision/cancellation.
- [x] Плюсик: выбор существующей папки и открытие здесь без ручного реестра.
- [x] Временная первая карточка текущей папки без истории (OPEN-04/05): отметка, только пояснение внутри, проверенное отсутствие истории, жизненный цикл и переход к обычной карточке без записи фиктивных данных.
- [x] Info/plus/name-path tooltip и отсутствие остальных popup.
- [ ] UI/accessibility/performance/security tests; обычные три последних диалога без цитат/пометок.

Gate C: матрица поиска и UI пройдена; нет открытия сообщений или чтения вложений.

## D. Выпуск

- [ ] DOC-01–04: написать `docs/extension-description.md`, подключить как README страницы Details, актуализировать manifest description/release notes, проверить exact contents и отображение установленного VSIX.
- [ ] Независимое review, исправления, повторная проверка.
- [ ] Версия, воспроизводимый VSIX, exact/negative verification, installed minimum/current.
- [ ] Индексация/поиск без Node/npm в системе.
- [ ] Evidence/commit/path/hash/размер/ограничения в handoff и пользовательская визуальная приёмка.

Статус: реализация C и автоматические проверки выполнены, проводится финальный source/release gate для кандидата0.3.0. Реальная визуальная/NVDA-приёмка не подменяется component tests и ожидается на установленном пакете. Нераспознанные control files fail-closed, row-scaled admission не гарантирует native memory isolation. Выпуск выполняется из отдельного чистого checkout без включения отложенных документов Step4.
