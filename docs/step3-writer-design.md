# Step 3: fenced writer и длинные поля

## Статус

Синтетическое discovery от 22 сентября 2026 года. Область изменений: только этот документ, `tests/discovery/step3-writer-fence.cjs` и последующий `tests/discovery/step3-json-extraction.cjs`. Production, package, план, handoff и исходная Kilo DB не изменялись. Никакие пользовательские реплики не читались. Стек уже согласован отдельно; данный отчёт не является новым согласованием или разрешением перейти через Gate A.

Техническая рекомендация: **механизм fenced writer пригоден как основа реализации; Gate A целиком пока не закрывать**. Последующий JSON probe ниже подтвердил минимальный точный путь через BLOB и whole-field нормализацию, включая длинные combining segments, но выявил row-sized native allocations даже при маленьком SQL chunk. Осталось разрешить конфликт фиксированного memory/per-operation budget с полнотой произвольной строки; cold-cache и интеграционные lifecycle-проверки также не подменяются этим отчётом. Явная отсрочка pathological part сохраняет корректность last-good, но не выполняет сама по себе требование импортировать всю допустимую историю.

Источники: `req/step3/01-requirements.md` (DB-04/06/07, SYNC-02/05/06, SEARCH-03/04, SEC-03), `req/step3/02-acceptance.md`, текущие plan/handoff; предыдущие probes `step3-sync.cjs`, `step3-disk-search.cjs`, материалы `docs/step3-discovery.md`. Это дополнение к прежним 1000/10000/100000 измерениям, а не повторение всего search corpus.

## Воспроизведение

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& '.\.vscode-test\vscode-win32-x64-archive-1.105.1\Code.exe' '.\tests\discovery\step3-writer-fence.cjs'
& '.\.vscode-test\vscode-win32-x64-archive-1.138.0\Code.exe' '.\tests\discovery\step3-writer-fence.cjs'
Remove-Item Env:ELECTRON_RUN_AS_NODE
npx eslint tests/discovery/step3-writer-fence.cjs
git diff --check -- tests/discovery/step3-writer-fence.cjs docs/step3-writer-design.md
```

Оба финальных runtime-прогона прошли; ESLint прошёл с явными imports. Minimum: Node 22.19.0 / Electron 37.6.0; current: Node 24.18.1 / Electron 42.10.0. Это bundled Electron Node, не реальный Extension Host и не установленный Step 3 VSIX. Скрипт не принимает пользовательские пути, создаёт уникальный временный каталог, порождает дочерние процессы того же Code.exe и удаляет только созданный каталог. `cleanup=true` на обоих runtime. Не создаётся постоянной службы.

## Доказательство Writer

В Hub находятся singleton `lease(generation, beat, owner)`, тестовая публикация и durable progress. `generation` увеличивается только при захвате; `beat` увеличивается при продлении или записи. В production оба счётчика должны проверяться на переполнение; probe явно проверяет safe integer generation. Owner должен быть случайным идентификатором экземпляра worker, а не переиспользуемым PID.

1. Претендент читает generation/beat и запоминает **собственное** `performance.now()`. Timestamp одного процесса никогда не сравнивается с timestamp другого. Системные часы и wall-clock expiry в базе не нужны.
2. После локального интервала неизменности он открывает `BEGIN IMMEDIATE`, заново читает lease и сравнивает generation/beat с наблюдением. Изменение любого значения запрещает takeover по старому наблюдению.
3. При совпадении атомарно увеличивает generation и beat, записывает owner и фиксирует transaction. Параллельный претендент либо получает busy, либо видит новую generation и отказывается.
4. Каждая запись, heartbeat и публикация сначала получают `BEGIN IMMEDIATE`, затем внутри этой же transaction проверяют owner/generation. Проверка до transaction недостаточна. Проекция, progress и heartbeat фиксируются вместе.
5. Если writer уже держит transaction, истечение lease само по себе не даёт другому процессу права записи: SQLite lock блокирует takeover. Если writer жив, но остановлен вне transaction, successor может сменить generation; возобновлённый старый writer обязан отвергнуть свои результаты.

В тесте локальное время имеет неотрицательную инъекцию offset. Это детерминированное продвижение monotonic clock на 15 секунд, **не измерение реального 15-секундного SLA**. Межпроцессный порядок задают подтверждённые IPC-сообщения, смерть подтверждается событием `exit`. Нет sleeps, после которых предполагается освобождение lock. Таймер 10 секунд используется только как deadline отказа IPC-теста.

Проверены семь групп:

- До истечения локального наблюдения claim отклоняется; успешный heartbeat инвалидирует уже истёкшее наблюдение другого процесса.
- После takeover прежний token отвергается для write, renew и hold; публикации отсутствуют.
- Открытая transaction второго процесса вызывает `SQLITE_BUSY` у претендента даже после инъекции истечения lease. Reader не видит незакоммиченный progress. После commit старое наблюдение также не проходит из-за нового beat.
- Владелец принудительно завершается с открытой transaction. Незакоммиченная публикация откатывается, committed предыдущая сохраняется; successor получает generation 3 и атомарно публикует progress.
- Два процесса одновременно предъявляют одно наблюдение generation 3: ровно один получает generation 4, другой получает отказ или busy. Двойного successor нет.
- Read-only synthetic source отвергает UPDATE; hashes main/WAL до и после сканирования совпадают. SHM byte identity не заявляется.
- Chunk scanner совпадает с whole-field Unicode oracle и явно откладывает превышение segment budget без выдачи частичного отрицательного результата.

Lease не запрещает кратковременное перекрытие **вычислений** остановленного старого writer и нового owner. Он запрещает публикацию stale-результата. Поэтому production должен проверять token между порциями работы, отменять generation-specific задачи, не держать длинный source scan внутри Hub write transaction. Проверка owner нужна также перед migrations, staging progress, cleanup и переключением rebuild. При замене файла Hub token должен включать случайный DB incarnation, иначе сброс generation создаёт ABA-риск.

## Длинный Текст

Scanner читает synthetic BLOB через `substr(payload, byteOffset, 32768)`, UTF-8 декодирует `StringDecoder`; это сохраняет Unicode scalar и NUL на границе транспортных chunks. Каждый scalar не превращается в отдельную строку/элемент массива. Отдельный part имеет отдельное состояние scanner: overlap нельзя переносить между разными полями.

Нормализация: `NFC → toLowerCase → ё=е → NFC`, как в предыдущем search probe. Независимая нормализация произвольных chunks неверна: composition/reordering, Hangul и контекстная Greek final sigma могут пересекать границу. Кандидатный scanner выпускает только префикс до последнего ASCII space. Space разрывает NFC и default-lowercase контекст. Остаток удерживается до безопасной границы/EOF. Другие whitespace намеренно не считаются доказанными границами.

Для поиска по уже нормализованному потоку scanner переносит хвост длиной `maxTokenUtf16Length - 1`. Это сохраняет буквальную подстроку любой проверяемой длины на границе порций, включая NUL. На каждом новом поле хвост сбрасывается. FTS здесь не используется; это кандидат literal fallback, не замена утверждённого FTS+instr плана. Minimum-three-code-points guard остаётся перед обращением к индексу; короткие внутренние needles в oracle проверяют primitive нормализации, а не новый пользовательский контракт поиска.

Проверки: 62 сравнения на всех размерах UTF-8 chunks для NFC combining/reordering, Hangul Jamo, Greek sigma, dotted I, ё, astral scalar и NUL; ещё одна проверка token длиннее 32 KiB и границы реального chunk. Всего **63 oracle comparisons** на каждом runtime. Whole-field oracle небольшой, не загружается весь огромный part для сравнения. Полнота огромного part подтверждается точным количеством прочитанных bytes, EOF, положительным хвостовым маркером и отрицательным отсутствующим токеном.

Огромный fixture: **11 534 352 bytes**, повторяемые синтетические Unicode/NUL блоки плюс уникальный tail. Создание fixture намеренно вне scanner budget. При росте неразрываемого сегмента более **262 144 UTF-16 units** scanner возвращает `deferred-oversize-segment` без `found`: нельзя выдать partial negative или отметить part импортированным. Тест на длинной combining sequence подтверждает этот путь; максимум pending до отказа 278 528 units, поскольку проверка выполняется после очередного 32 KiB блока. Допустимый максимум query в primitive такой же; production нельзя молча превратить это в продуктовый лимит без отдельного решения.

Это bounded **JS transport/normalization candidate**, не доказательство константной полной памяти native SQLite. В source Kilo текст находится в JSON, а fixture здесь уже содержит выделенный text BLOB. Нельзя перенести `json_extract` целого огромного payload и объявить память ограниченной только потому, что результат затем разбит на chunks. SQLite также может материализовать весь BLOB на каждом `substr`; наблюдаемая стоимость требует дальнейшего исследования.

## Измерения

Финальные minimum/current прогоны выполнялись последовательно; minimum одновременно с ESLint. Данные после создания/хеширования fixture, то есть **не cold cache**. Это одиночные измерения, не p95 и не универсальная верхняя граница.

| Метрика | Minimum | Current |
| --- | ---: | ---: |
| Forced busy, включая IPC, ms | 154,36 | 158,08 |
| Полный scan 11 534 352 bytes, ms | 8796,52 | 8052,05 |
| Максимальный измеренный шаг scan, ms | 61,13 | 35,48 |
| Максимум pending нормального part, UTF-16 units | 26071 | 26071 |
| RSS перед scan, bytes | 44720128 | 44998656 |
| Максимум sampled RSS scan, bytes | 52146176 | 57733120 |
| Максимум sampled heapUsed, bytes | 7529028 | 11554376 |
| Максимум sampled external, bytes | 2565961 | 3227057 |

Память снимается после каждого chunk. Между samples возможен более высокий пик; RSS включает fixture connection, SQLite, IPC и Electron Node, не только scanner. Дочерние процессы не включены в parent RSS. Hashing выполняется отдельным фиксированным 32 KiB buffer. `arrayBuffers=0` на этих Electron runtime не означает отсутствие внешних allocations. Ни memory cap, ни interruptibility синхронного SQLite этим не доказаны.

Предлагаемые engineering budgets до следующей проверки: transport 32 KiB, pending 256 Ki units с явным incomplete, Hub transaction не более 256 KiB staged data или 100 rows (что наступит раньше), целевой p95 transaction ≤50 ms и предел cooperative batch 100 ms, busy timeout 80 ms с retry вне transaction, heartbeat ≤5 s при lease 15 s. Наблюдённый busy 154–158 ms показывает, что SQLite timeout не равен строгому внешнему deadline. Watchdog worker должен ограничивать зависание независимо от SQLite.

Полный scan уже занимает 8–9 s для одного 11 MiB part: использовать его каждые 10 s для всей истории нельзя. Poll раз в 10 s только обнаруживает изменения; импорт и сверка идут возобновляемыми порциями, без очереди дублирующих циклов. Оценка обнаружения смерти свободного владельца: до 10 s до первого наблюдения + 15 s неизменности + до 10 s до следующего poll, то есть ориентир ≤35 s при работающих процессах и отсутствии lock contention. Это расчётный, пока не измеренный SLA; suspended OS/host и удерживаемый lock исключают такую гарантию.

## Следующий Дизайн

1. После полного Gate A создать единственный worker-координатор на окно, общую для фактического storage scope Hub DB, раздельные source readOnly и Hub writable connections. Перед writable open применить существующие path/identity guards; discovery этого файла не заменяет SEC-03 и не устраняет filesystem TOCTOU.
2. Держать lease/incarnation и schema version в Hub. Acquisition/migration выполняются под `BEGIN IMMEDIATE`; любое изменение проверяет token внутри transaction. Не удалять/пересоздавать lease отдельно от incarnation. Result messages несут incarnation/generation/revision; UI получает только metadata.
3. Source чтение и CPU-преобразование выполняются вне Hub write lock. Bounded результаты записываются в staging с token/progress. Полный part/session публикуется лишь после успешного scan и проверки source revision/snapshot; partial failure не удаляет last-good. На restart staging продолжает работу либо безопасно пересчитывается. При commit projection, FTS и cursor изменяются атомарно.
4. Для огромного JSON исследовать bounded чтение `CAST(data AS BLOB)` и streaming JSON decoder с отбором только DB-06. Не переносить raw JSON в постоянную Hub projection. Если SQLite повторно материализует всю строку, измерить альтернативный source extraction в отдельном disposable worker с explicit resource failure; простое уменьшение chunk не исправляет асимптотику.
5. Для безграничного normalization segment нужен отдельный доказанный external-memory алгоритм Unicode normalization/context casing либо иной доказанный путь без произвольного ограничения истории. Spill должен находиться только в защищённом служебном Hub staging, очищаться после crash и не публиковаться до завершения. Одного сохранения хвоста 32 KiB недостаточно: combining sequence и case-ignorable context могут быть произвольно длинными. До этого deferred означает незавершённый индекс, а не полноту.
6. После нормализации хранить chunks с field/part identity и последовательностью. Trigram candidates должны учитывать границы chunks и NUL fallback. Точная проверка длинного токена должна идти по последовательности chunks одного поля, без конкатенации разных parts; простой FTS по отдельным неперекрывающимся chunks даст false negative. Существующая FTS+instr семантика должна сохраниться при новом физическом хранении.

## Оставшиеся Проверки

- Проверить настоящий monotonic lease без injected clock в двух одновременно работающих Extension Hosts, reload/dispose/suspend/resume, heartbeat starvation, clean close и orphan worker. Этот probe использует процессы, production будет использовать Worker Threads.
- Atomic generation/owner tests для migrations, cleanup, heartbeat, durable partial progress, source replacement и rebuild switch; DB incarnation/ABA, переполнение counters, crash до/после commit, disk-full/corruption.
- Огромный настоящий synthetic JSON с escape/surrogate/NUL и DB-06 flags; source mutation во время chunk scan, bounded snapshot/WAL growth, restart и отсутствие torn part. Read-only snapshot для такого extraction обязателен; текущий fixture при scan не меняется.
- Внешняя Unicode normalization для неограниченных combining/no-space сегментов и очень длинных query tokens; exact oracle, ложные совпадения между parts, boundary FTS candidates и query cancellation.
- Cold-cache или честно воспроизводимый first-open benchmark, distributions/p95 на корпусе и нескольких размерах huge part, native memory peak и worker termination deadline. Не объявлять текущие sampled measurements hard memory limit.

Итог: safety fencing подтверждена синтетическими межпроцессными сценариями на minimum/current. Huge ordinary part обработан до EOF без усечения, Unicode/NUL candidate проверен, pathological input получает явный отказ от публикации. Полнота произвольного input и итоговые performance/freshness budgets ещё требуют discovery; технического основания автоматически закрыть весь Gate A этим probe нет.

## Последующий JSON Probe

`tests/discovery/step3-json-extraction.cjs` проверяет именно `part.data TEXT` с JSON, а не предварительно выделенный BLOB. Схема содержит session/message/part; SQL сохраняет DB-06 joins, user/type/text/flags и root/non-archived отбор. Fixtures используют escaped Unicode, surrogate pairs, `\u0000`, quotes, backslash и newline. Тексты генерируются, не читаются из Kilo или проектов.

Каждый вариант выполняется в **новом дочернем процессе bundled Code.exe**. Процесс создания fixture и whole `JSON.parse` oracle завершён до измерений reader. Parent оставляет synthetic writer с работающим WAL; остальные connections `readOnly:true` и `query_only=ON`, snapshot открывается на всю операцию. Main/WAL hashes неизменны до/после всех reader-прогонов. Только synthetic writer создаёт базу; readers не выполняют source checkpoint/journal-mode/migrations. Между вариантами OS cache не сбрасывается: это first-open процесса, **не cold-cache**. Процессы только тестовая изоляция измерений, не изменение утверждённого production Worker Threads стека.

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& '.\.vscode-test\vscode-win32-x64-archive-1.105.1\Code.exe' '.\tests\discovery\step3-json-extraction.cjs'
& '.\.vscode-test\vscode-win32-x64-archive-1.138.0\Code.exe' '.\tests\discovery\step3-json-extraction.cjs'
Remove-Item Env:ELECTRON_RUN_AS_NODE
npx eslint tests/discovery/step3-json-extraction.cjs
git diff --no-index --check -- /dev/null tests/discovery/step3-json-extraction.cjs
```

Финальные прогоны прошли последовательно на minimum/current; ESLint прошёл. SQLite 3.50.4 / 3.53.1 соответственно. `sourceMainWalUnchanged=true`, `cleanup=true`. Global `hard_heap_limit`, сторонние native dependencies и production-код не используются.

### Точность И NUL

**Найден обязательный compatibility fix для будущего adapter:** на minimum выражение `SELECT json_extract(p.data,'$.text') AS text` возвращает JS-строку только до первого NUL: **39 bytes вместо 1 048 633**. Hash точно равен oracle-префиксу до NUL; tail теряется. На current TEXT-путь возвращает полную строку. Это не означает, что `json_extract` сам потерял хвост внутри SQLite: `CAST(json_extract(p.data,'$.text') AS BLOB)` на обоих runtime возвращает полные bytes. Поэтому для общего adapter возвращать **BLOB с явным UTF-8 decoding**, а не полагаться на TEXT conversion minimum. Это отдельная проблема от ранее обнаруженного FTS NUL fallback; исправление только поискового MATCH её не устраняет.

Проверены пять whole fields и те же пять полей через 256 KiB disk staging, плюс 12 MiB поле через 32 KiB staging. Каждый путь сравнивает полный raw SHA-256, normalized SHA-256, raw/normalized byte counts и восемь substring needles с whole `JSON.parse → NFC → lower → ё=е → NFC` oracle. Staging дополнительно сравнивает hash и точное число записанных bytes; EOF обязателен. Ни skip, ни усечения на этих путях нет.

| Fixture | JSON bytes | Text bytes | Особенность |
| --- | ---: | ---: | --- |
| Обычный 1 MiB | 1737336 | 1048633 | Повторяемые Unicode/NUL/escape блоки и tail |
| Обычный 4 MiB | 6948897 | 4194350 | То же |
| Обычный 12 MiB | 20846430 | 12582951 | То же, более 11 MB текста |
| Combining/context без пробелов | 1800098 | 600023 | 300000 combining marks, поздний более низкий CCC и Greek sigma перед следующим cased scalar |
| 12 MiB без пробелов | 12582986 | 12582927 | Непрерывное ASCII поле и tail |

Whole-field нормализация не имеет искусственного лимита длины combining sequence: пример 300019 UTF-16 units полностью обработан, в отличие от прежнего space-boundary candidate. Это свидетельство корректности минимального алгоритма для помещающейся в runtime строки, **не утверждение о бесконечной памяти** и не доказательство bounded streaming normalizer. Lone surrogate/malformed UTF-8 здесь не добавлялись в контракт: fixtures содержат корректные пары и JSON escapes.

### Измерения JSON

Таблица относится к финальным прогонам. `maxRSS` получен через `process.resourceUsage().maxRSS` в KiB: он захватывает native high-water между JS samples. Whole peak включает последующие normalization/hash/assertion allocations, не только SELECT; first-chunk peak снят до накопления или whole normalization. Родитель и fixture-builder в память reader не включены.

| Метрика | Minimum | Current |
| --- | ---: | ---: |
| Whole 12 MiB: extraction + decoding, ms | 131,94 | 113,99 |
| Whole 12 MiB: normalize, ms | 142,15 | 149,67 |
| Whole 12 MiB: весь reader/validation, ms | 383,18 | 393,14 |
| Whole 12 MiB: maxRSS, KiB | 146912 | 172676 |
| 256 KiB chunks: extraction/staging 12 MiB, ms | 5623,53 | 5251,66 |
| 256 KiB chunks: максимальный SQL вызов, ms | 198,70 | 220,11 |
| 256 KiB chunks: maxRSS после первого результата, KiB | 93544 | 93356 |
| 32 KiB chunks: extraction/staging 12 MiB, ms | 51625,05 | 55625,04 |
| 32 KiB chunks: максимальный SQL вызов, ms | 233,29 | 335,29 |
| 32 KiB chunks: maxRSS после первого результата, KiB | 92976 | 95692 |
| Whole 300000 marks: normalize, ms | 16,75 | 12,23 |
| Whole no-space 12 MiB: normalize, ms | 60,79 | 48,03 |

Для 256 KiB chunks максимум возвращаемых bytes действительно 262144, но это **не native memory bound**. При росте текста 1 → 4 → 12 MiB first-result maxRSS на minimum растёт 44944 → 58120 → 93544 KiB; current 44708 → 57896 → 93356 KiB. Уменьшение результата до 32 KiB почти не меняет этот peak, зато увеличивает число SELECT с 50 до 386 и время примерно на порядок. Это согласуется с повторным разбором/материализацией строки на каждом вызове; не заявляется отдельное профилирование allocator или формально доказанная точная асимптотика.

Проверен также `substr(CAST(data AS BLOB),1,32768)` **без `json_extract`**. Для JSON 20846430 bytes он занимает 26,74 / 24,57 ms и увеличивает high-water с 39756 до 60356 / с 39508 до 60184 KiB. Поэтому даже собственный streaming JSON decoder поверх такого SQL ещё не обеспечивает fixed native budget: источник уже материализует строку. Прямое чтение страниц DB/WAL самописным парсером не предлагается из-за snapshot/locking/corruption рисков.

Полезный минимальный primitive: **`SELECT octet_length(data)`** читает длину столбца без выдачи JSON. Для того же поля: 0,11 / 0,10 ms, high-water после metadata 42528 / 39748 KiB при baseline 42344 / 39504 KiB. Следовательно, можно делать preflight размера без первоначальной полной загрузки. Нельзя заменять его `length(CAST(data AS BLOB))`: в первом эксперименте такая форма уже поднимала native peak примерно на размер JSON. И нельзя сначала запускать `json_extract(type/flags)`, а потом считать размер: parsing уже состоялся. Preflight должен быть отдельным запросом на голый столбец в том же read snapshot, до JSON-функций.

На обоих runtime `DatabaseSync.prototype` не содержит incremental BLOB handle API; список методов записывается probe. SQLite compile option `MAX_LENGTH=1000000000` не означает доступность такого объёма памяти или строки в V8. Наличие SQLite C API `sqlite3_blob_read` не предоставляет его автоматически через `node:sqlite`.

### Корпус И Fail-Safe

Дополнительно полностью извлечены и нормализованы **100000** небольших user-text parts в **10000** sessions / **1000** папках. Keyset batches по 100 строк, всего 1000 batches, без массива всего корпуса. Aggregate normalized hash совпал с независимо сгенерированным oracle: `04b3526c43e8528555153d9fa08d62a0db8eb44fbc8046b8d155e4621cec7ebd`.

| Метрика corpus | Minimum | Current |
| --- | ---: | ---: |
| Полный проход, ms | 611,46 | 666,12 |
| Максимальный batch, ms | 1,92 | 1,63 |
| Максимальный text payload batch, bytes | 18602 | 18602 |
| maxRSS, KiB | 60188 | 62544 |

Это extraction/normalization, **не FTS build или полный importer**. Гигантские пять полей проверены отдельно; LIMIT 100 сам по себе не ограничивает bytes для произвольных данных. SQL/JS yields между batches возможны, но в тесте не измерялись host event loop и реальная cancellation.

Отдельный детерминированный resource-error тест начинает Hub transaction, изменяет publication/progress, затем отвергает 12 MiB поле по тестовому preflight budget 1 MiB. После `ROLLBACK` publication и cursor байт-в-байт логически равны last-good; attempted generation не объявляется complete. Source hashes сохранены. Это **не реальный OOM** и не разрешённый product limit 1 MiB; это только доказательство корректной ветки SYNC-05. Статус прежней успешно завершённой generation не выдаётся за полноту новой. Такой отказ не доказывает DB-04 для всей истории.

### Решение И Альтернативы

Минимальный точный кандидат: отдельный size preflight, затем один `CAST(json_extract(...,'$.text') AS BLOB)` на поле, явное UTF-8 decoding, штатная whole-string normalization, запись нормализованного результата в bounded Hub batches. Последние можно дробить без изменения уже выполненной whole normalization; search всё равно должен сохранять семантику одного поля на границах chunks. Память такого пути зависит от **максимального поля**, а не всей истории; для проверенных 100000 обычных parts и 12 MiB полей полнота подтверждена. Space-boundary normalizer и disk round-trip для этих размеров не нужны: они сложнее и медленнее, а native memory problem не решают.

Точный оставшийся блокер: **не доказано, что каждое допустимое DB-06 поле можно обработать под фиксированным небольшим memory/per-operation budget на доступном API**. Даже 12 MiB уже превышает предложенный cooperative 100 ms на SELECT/normalize и даёт до 172676 KiB process high-water. Native allocation происходит внутри синхронного SQLite до возвращения chunk. `Worker.resourceLimits` ограничивает V8 heap, не SQLite/native allocations; перенос в Worker не превращает resource failure в безопасное исключение и не гарантирует немедленный interrupt. Фиксированный cap/retry сохраняет last-good, но может навсегда оставить допустимое поле неимпортированным. Это конфликт выбранного строгого bounded-budget пути с полнотой DB-04, **не доказательство логической невозможности любых реализаций требований**.

Возможные дальнейшие решения, без молчаливого выбора:

1. Сохранить минимальный whole-field алгоритм и явно согласовать ресурсный контракт: bounded corpus batches, row-scaled работа для одиночного поля, измеренный memory target, отдельная политика безопасного отказа/повтора. Затем доказать native resource isolation и жизненный цикл; простое обещание «всегда ≤64 MiB/100 ms» неверно. Произвольный permanent skip или скрытый лимит истории недопустим. Нынешние тесты не дают основания объявить произвольно огромные поля покрытыми.
2. Если нужен fixed small memory bound независимо от размера допустимого поля, требуется доступный incremental read primitive вместо materializing SQL, затем проверенная external-memory Unicode normalization/context casing. Это расширение исследуемой архитектуры, а не небольшая правка `substr`; другой SQLite runtime/binding или native dependency требует отдельного рассмотрения и не добавлен в этой работе. Написание speculative stream normalizer до решения native source-read проблемы нецелесообразно.
3. Уточнение допустимого максимального поля/семантики resource failure на уровне требований уменьшило бы задачу, но является продуктовым решением. Оно здесь не принято и не заменяется соглашением со стеком. Ни global SQLite heap limit в общем Extension Host, ни stream-safe вставка CGJ/удаление marks (меняют substring semantics) не являются допустимым обходом.

Техническая готовность: JSON correctness/NUL compatibility и полная обработка исследованных больших/combining полей установлены; эффективный обычный путь найден. Гарантия фиксированных ресурсов для произвольного поля остаётся конкретным незакрытым вопросом. Gate A этим отчётом не отмечается завершённым; owner primitive для control-store replacement относится к отдельному parent pipe probe и здесь не переизобретался.
