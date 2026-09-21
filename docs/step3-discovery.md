# Step 3: предварительный discovery

## Статус

Исследование исходников выполнено 21 сентября 2026 года. Это source evidence, не завершённый runtime discovery и не утверждение стека. Личная `kilo.db` и реальные сообщения не читались, Kilo CLI не запускался, источник не изменялся.

Установленный Kilo Code сообщает `7.7.5`. Upstream-тег `v7.7.5` разрешён в commit `01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb`. Побайтовое соответствие встроенного executable этому commit не устанавливалось. Перед реализацией проверить фактически поддерживаемые версии.

## Первичные источники

Все пути относятся к [закреплённому commit](https://github.com/Kilo-Org/kilocode/tree/01ef456fe7f41aa1f7b8a4e6b545dd1e0fbeeceb).

| Путь | Свидетельство |
| --- | --- |
| `packages/core/src/session/sql.ts` | Таблицы session/message/part, связи, timestamps и JSON data. |
| `packages/schema/src/v1/session.ts` | User/Assistant, TextPart, synthetic/ignored и события. |
| `packages/core/src/database/schema.sql.ts` | Timestamps и ORM `$onUpdate`. |
| `packages/core/src/session/projector.ts` | Upsert/delete message/part без обязательного изменения родительской session. |
| `packages/opencode/src/session/session.ts` | update/remove, setArchived и удаление журнала session. |
| `packages/opencode/src/session/compaction.ts` | Автоматические user messages и synthetic continue/replay. |
| `packages/opencode/src/session/revert.ts` | Удаления/изменения истории, источник не append-only. |
| `packages/core/src/event/sql.ts` | event/event_sequence, последовательность на aggregate. |
| `packages/core/src/event.ts` | Durable commit и удаление событий aggregate. |
| `packages/core/src/kilocode/session/recall-part-index.ts` | Поиск Kilo исключает synthetic/ignored text parts. |

## Подтверждено исходниками

- `message`: id PK, session_id FK с cascade, timestamps, JSON data с role. Текст хранится в parts, не в message.content.
- `part`: id PK, message_id FK с cascade, session_id, timestamps, JSON data. Продублированную part.session_id необходимо сверять со связями message/session.
- TextPart имеет text и необязательные synthetic/ignored. Role=user не доказывает человеческое авторство. Немаркированный смешанный текст нельзя надёжно разделить.
- `$onUpdate` — ORM-механизм строки, не SQL-trigger обновления родительской session.
- Изменение text-part и удаление message/part не обязаны менять session.time_updated. Архивирование также может сохранить updated. Watermark только по session неверен.
- `event_sequence`: aggregate_id/seq/owner_id. `event`: id/aggregate_id/seq/type/data; уникальность aggregate+seq. Это per-session cursor, не глобальный счётчик.
- Durable commit связывает projector, sequence и event одной транзакцией. Потоковые `message.part.delta` не durable.
- После удаления session Kilo удаляет её event/event_sequence. Постоянный tombstone удалённой session не гарантирован; нужна сверка ID.

## Инженерные выводы

Sequence можно рассматривать как оптимизацию, не единственную гарантию полноты. Читать актуальную целевую проекцию без копирования event payloads. Периодически сверять membership sessions/messages/parts после gap/reset/import/migration. Курсоры и проекцию фиксировать атомарно в Hub, источник читать согласованными короткими read-only snapshots. Ошибка/отмена не доказывает удаление. Эти решения ещё требуют runtime-доказательств.

## Незавершённый discovery

1. Schema guard, версии adapter и query plans bounded чтения без создания индексов в Kilo.
2. Initial snapshot/cursor при конкурентных изменениях, reconciliation и смена/замена исходной базы.
3. Отбор mixed/synthetic/ignored на синтетической истории.
4. SQLite/FTS5/tokenizers во встроенном runtime minimum/current VS Code, не только системном Node.
5. Буквальные подстроки, запросы 1–2 символа, Unicode и ё/е; FTS5 не подменяет семантику ТЗ.
6. Worker lifecycle, активация без панели, координация writer и реальная область storage профилей VS Code.
7. Защита от направления writable Hub connection в Kilo, включая идентичность файлов.
8. Бюджеты памяти/batch/диска, свежесть и интервал тяжёлой сверки на синтетическом корпусе.
9. Миграции только Hub, атомарная замена восстановленного индекса, disk full и crash recovery.
10. Установленный VSIX без Node/npm/SQLite/Kilo CLI в системе.

## Кандидат стека

SQLite, встроенный `node:sqlite`, Worker Thread, FTS5 только при доказательстве требуемой семантики. Предложение НЕ утверждено; результаты измерений и окончательный стек согласовать с пользователем до реализации собственной базы.
