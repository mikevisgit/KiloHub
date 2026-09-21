# Передача состояния Kilo Hub

## Текущее состояние

- Статус: пользовательская визуальная приёмка `0.2.0` выявила blocking CSS-дефекты; готовится hotfix `0.2.1`, прежний VSIX не является финальным.
- Ветка: `master`.
- Исходный коммит: `9642700 Align Step 1 with Kilo SQLite history`.
- В начале работы рабочее дерево было чистым.
- Локальная версия Node.js: `v24.13.0`.
- Локальная версия npm: `11.6.2`.
- Первый найденный в `PATH` совместимый CLI сообщает версию Cursor `1.2.4`; среда хоста Kilo сообщает VS Code `1.138.0`.
- Среда хоста Kilo Code сообщает версию `7.7.5` на `win32-x64`.
- Отдельный CLI `kilo` отсутствует в `PATH`; он не является runtime-зависимостью.

## Источники scope

- Требования продукта: `req/step1/01-requirements.md`.
- Контракт исследования storage: `req/step1/02-discovery.md`.
- Техническое направление: `req/step1/03-technical-plan.md`.
- Приёмка: `req/step1/04-preparation-and-acceptance.md`.
- План выполнения: `specs/step1-implementation-plan.md`.
- Нормативный Step 2: `req/step2/README.md`, `req/step2/02-уточнение-ТЗ.md` и `req/step2/ТЗ реализации дизайна VSIX.md`.
- План Step 2: `specs/step2-implementation-plan.md`.

## Прогресс

- [x] Прочитаны и согласованы между собой все документы требований Step 1.
- [x] Зафиксированы границы отдельных каталогов.
- [x] Запущены независимые исследования SQLite, UI и packaging.
- [x] Подтверждены реальное расположение и schema `kilo.db` на основании read-only данных.
- [x] Выбран и доказан SQLite runtime внутри упакованного расширения: `node:sqlite` подтверждён development и installed Extension Host tests.
- [x] Реализованы metadata adapter и domain projection.
- [x] Реализованы Activity Bar view и команды.
- [x] Завершены автоматические тесты и независимое ревью; code remediation и повторные проверки выполнены.
- [x] VSIX собран, exact-проверен, установлен и прошёл development/installed Extension Host smoke.
- [x] Здесь опубликованы точный путь и checksum итогового артефакта.

## Выполненные проверки

- `npm install` создал lockfile с точными dev dependencies.
- После удаления `@vscode/test-cli` и обновления `esbuild` команда `npm audit` сообщает `0 vulnerabilities`.
- `git diff --check` проходит для текущих текстовых изменений.
- `npm run test:unit` прошёл для domain projection: 9/9 tests, включая 1 000 sessions в 100 folders.
- `npm run check-types` и `npm run lint` проходят после интеграции projection.
- Изолированный adapter suite прошёл 13/13 top-level/subtests: resolver, schema/version guard, row isolation, read-only/query-only, WAL visibility, busy timeout и освобождение файла.
- Прогон до независимого review прошёл: typecheck, ESLint, 22 unit tests и Extension Host test на VS Code `1.105.1`.
- Extension Host подтвердил Node `22.19.0`, Electron `37.6.0`, загрузку `node:sqlite`, четыре command IDs, view contract, tree contract и неизменность fixture DB.
- Exclusive-lock тест подтвердил bounded `SQLITE_BUSY` примерно за 7 секунд при настроенном SQLite timeout `5000 ms`.
- После security review SQLite перенесён в отдельный worker thread с outer timeout `10000 ms` и heap limit `64 MB`; timer test доказывает, что busy wait не блокирует Extension Host event loop.
- Текущий remediation suite проходит: 27 unit/subtests, включая реальную primary-key semantics, deterministic canonical path, warning sanitization, availability concurrency `<=16` и resolved local path checks.

## Решения

- Kilo остаётся единственным источником истины; реестр Hub и постоянный кэш не создаются.
- Production-код, тесты, спецификации, документация, ревью, промежуточная сборка и дистрибутивы разделены по каталогам.
- Отсутствие отдельного Kilo CLI не блокирует runtime-реализацию; CLI используется только как discovery oracle, когда доступен.
- Пункт реализации не считается завершённым, пока не записаны доказательства проверки.
- Вся проектная документация ведётся на русском языке.
- Расширение выполняется локально с `extensionKind: ["ui"]`, чтобы не читать Windows storage из Remote Extension Host.
- View активирует расширение лениво; параллельные refresh объединяются в одну выполняющуюся операцию.
- Стабильные `TreeItem.id` сохраняют раскрытие папок после refresh; missing actions не получают `command`.
- SQLite `immutable=1` запрещён для работающей WAL-базы, поскольку может скрыть изменения из WAL. Требуется настоящий read-only режим с учётом WAL.
- Для packaging spike выбран встроенный `node:sqlite` без runtime npm dependencies; кандидатный минимум — VS Code `1.105.1`, первый target — `win32-x64`.
- Активная база найдена в `%USERPROFILE%\.local\share\kilo\kilo.db`; SQL и CLI oracle совпали по всем 31 root/non-archived sessions.
- Timestamps `session.time_created` и `session.time_updated` являются Unix milliseconds; schema guard проверяет семь обязательных колонок и разрешает дополнительные.
- Manifest использует положительный allow-list `files`; `.vscodeignore` не создаётся. Packaging автоматически фиксирует ZIP timestamp по последнему Git commit и проверяет запрещённые entries.
- Build environment закреплён как Node `22.20.0` и npm `11.6.2`; локальная проверка выполняется на совместимом Node `24.13.0` с lockfile v3.

## Итоговый артефакт

- Source commit: `e777265 fix: address Step 1 review findings`.
- Путь: `D:\VSCode\KiloHub\dist\kilo-hub-0.1.0-win32-x64.vsix`.
- Размер: `12857` bytes.
- SHA-256: `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`.
- Target: `win32-x64`.
- `engines.vscode`: `^1.105.1`.
- Exact package entries: 8, включая `extension/build/extension.js` и `extension/build/kiloDataWorker.js`; source/tests/fixtures/node_modules/DB отсутствуют.
- Две последовательные clean сборки дали одинаковый SHA-256.
- Изолированная установка подтверждена на VS Code `1.105.1` и Stable `1.138.0`; `local.kilo-hub@0.1.0` присутствует в отдельном extensions directory.

Release gate выполнен командами: `npm ci`, `npm audit --audit-level=high`, `npm test`, два раза `npm run package`, `npm run test:installed`, а также isolated `code --install-extension ... --force` и `code --list-extensions --show-versions`. Для npm-команд принудительно задан `NODE_TLS_REJECT_UNAUTHORIZED=1`; полный протокол находится в `docs/verification.md`.

## Активные риски

- Реализация SQLite должна работать в Windows Extension Host VS Code и сохранять работоспособность после упаковки в VSIX.
- Определение пути и schema guard требуют доказательств из данных или кода Kilo 7.7.5.
- Если будет выбрана native-зависимость, она должна совпадать с Electron/Node ABI поддерживаемого VS Code.
- Полная UI-проверка может заменить текущий workspace, поэтому установка и действия проверяются в изолированном профиле и окне.
- Версию создателя общей базы нельзя без доказательств выводить из версии установленного VS Code extension; compatibility должен определяться подтверждённой schema signature либо metadata самой базы.
- Read-only WAL reader может обновлять технические read-marks в существующем `kilo.db-shm`. Проверки доказывают неизменность `kilo.db`, WAL и logical sessions; byte identity SHM не заявляется как свойство SQLite.
- Проверка `realpath` блокирует существующие mapped/reparse paths, разрешающиеся в UNC, но сама первичная Windows resolution может кратковременно обратиться к network provider; операция ограничена timeout и concurrency.
- Live probe выявил и исправил несовпадение SQLite `notnull` для `TEXT PRIMARY KEY`: production guard теперь проверяет `pk=1`; рабочая Kilo DB успешно возвращает 31 root session через worker.

## Следующее действие

Артефакт готов к локальной установке. Единственный эксплуатационный residual gate — визуальный клик-тест трёх переходов в disposable GUI window; command wiring и exact VS Code API options проверены автоматически, но автоматический installed test намеренно не заменяет workspace и не открывает Explorer.

## Дизайн-задача

- Историческая задача для дизайнера: `req/step2/old_donotuse/design-task.md`.
- Baseline dark/collapsed: `req/step2/screenshots/image.png`.
- Baseline light/expanded: `req/step2/screenshots/image2.png`.
- Функциональный scope Step 1 зафиксирован неизменяемым; новые команды, сущности, settings, webview и функции запрещены.
- Во втором скриншоте присутствуют локальные metadata. В задаче зафиксирован запрет на публикацию и требование обезличить итоговые макеты.

## Дизайн Step 2 — отдельное задание и статические концепции

По явному запросу пользователя создана отдельная версия `desing/design-task-v2.md`. В ней сохранено назначение Hub и описаны baseline/функции, но дизайн больше не ограничен нативным деревом. Цели — крупные читаемые названия, узнаваемые папки и понятный переход между местами работы. Форму решения дизайнер выбирает свободно. Показ до трёх последних диалогов — согласованное отличие представления от Step 1; полный список папок сохранён.

Готовы семь разных статических HTML-вариантов: монограммы, крупный текст, силуэты папок, лента ориентиров, мозаика, рабочая тетрадь, контрастные блоки. Галерея: `D:\VSCode\KiloHub\desing\variants\index.html`. Состояния и узкая панель: `desing/variants/states.html`. Описание: `desing/variants/README.md`. Все примеры вымышлены, внешних ресурсов и рабочей интеграции нет.

Проверки: `node desing/variants/build.mjs`, `node --check desing/variants/build.mjs`, структурная проверка HTML (локальные ссылки, семь вариантов, пять папок в каждом, отсутствие внешних ресурсов и браузерных скриптов), `git diff --check`. Визуальный рендер не подтверждён: Browser Use отклонил локальный `file` URL по политике безопасности и запретил обход. Вкладки не были открыты этим действием. Пользователю доступны локальные файлы для самостоятельного просмотра.

Production-код, база Kilo, нормативные `req/step1/`, исходное ТЗ и VSIX не изменены. Следующий шаг — визуально сравнить варианты и выбрать направление, не считая макеты реализацией расширения.

### Вторая серия: десять монограмм

Пользователь самостоятельно открыл первые варианты и выбрал монограммы как наиболее понравившееся направление. По отдельному запросу добавлены десять вариантов: большой знак, круги, цветная шапка, контур, поле слева, по центру, ночные знаки, билеты, два масштаба и ярлыки. Галерея: `D:\VSCode\KiloHub\desing\variants\monograms\index.html`. Первые семь HTML не изменены.

Проверки: `node desing/variants/monograms/build.mjs`, `node --check desing/variants/monograms/build.mjs`, структурная проверка всех 11 новых HTML (10 концепций и галерея), локальные ссылки, состав папок/диалогов, недоступные действия, отсутствие внешних ресурсов/браузерных скриптов, `git diff --check`. Новое браузерное открытие не выполнялось; визуальный рендер не подтверждён. Следующий шаг — сравнение десяти композиций пользователем; окончательный дизайн не выбран.

### Третья серия: лаконичные монограммы и темы VS Code

По новому запросу и reference пользователя созданы пять дополнительных вариантов: спокойный список, тонкие рамки, название впереди, общее поле и строка-ярлык. Галерея: `D:\VSCode\KiloHub\desing\variants\vscode-monograms\index.html`. В каждом файле три статические тематические демонстрации: dark, light, high contrast. Предыдущие 17 концепций сохранены.

`panel.css` использует `--vscode-*` с fallback, а `demo-themes.css` содержит только самостоятельные демо-палитры. Токены сверены с официальными Theme Color Reference и Webview API. Автономный HTML не получает тему редактора; интеграция не реализована. Production-код и требования Step 1 не изменялись.

Проверки: `node desing/variants/vscode-monograms/build.mjs`, `node --check desing/variants/vscode-monograms/build.mjs`, `node desing/variants/vscode-monograms/verify.mjs`, `git diff --check`. Подтверждены 6 HTML, 5 × 3 темы, ссылки/якоря, состав папок/диалогов, disabled actions и отсутствие внешних ресурсов. Все 23 используемых цветовых токена заданы во всех трёх палитрах. Минимальный расчётный контраст десяти текстовых пар: dark 4,79:1; light 5,50:1; high contrast 15,46:1. Это расчёт палитр, не визуальная приёмка. Браузерное открытие не повторялось после запрета; рендер и фактическая работа в пользовательских темах остаются непроверенными.

### Экспертное ревью «Тонких рамок» для абсолютного новичка

Пользователь выбрал `desing/variants/vscode-monograms/02-inset.html` и запросил 20 замечаний с позиции человека без навыков ИТ. Отчёт: `D:\VSCode\KiloHub\reviews\design-inset-novice-top20.md`. В нём ровно 20 пунктов по приоритету с фактами HTML/CSS, гипотезами восприятия, последствиями и направлениями исправления. Главные риски: понимание последствий открытия папки, ожидание открытия пассивных диалогов и ориентация в текущем/недоступном/необновлённом состоянии.

Это экспертная оценка, не реальное пользовательское тестирование. Прочитаны три тематические секции и стили, повторно прошёл `node desing/variants/vscode-monograms/verify.mjs`; количество замечаний и `git diff --check` проверены. Браузер не открывался, рендер не подтверждён. Макет, CSS, production, нормативные требования и данные Kilo не изменены. Исправления по ревью пока не выполнялись; следующий шаг — обсуждение и проверка гипотез.

### Рабочий файл UX-предложений

По прямой просьбе пользователя создан `D:\VSCode\KiloHub\desing\UX правки.md` для его ручного редактирования. Сохранены только выбранные номера 1, 2, 3, 6, 7, 8, 9, 10, 13, 15, 17. В пункте 13 учтено уточнение: последняя Kilo-активность внутри плашки каждой папки, время чч:мм только сегодня; строгие пороги относительных дат не заданы. Пункты 2 и 17 отмечены как предложения изменения поведения, ещё не реализованные. Проверены наличие файла, UTF-8, 11 номеров, ссылки и `git diff --check`. Макеты, ТЗ v2 и production не изменены; следующий шаг — правка документа пользователем.

Пользователь принял решение по пункту 1: сохранить «Открыть в этом окне», без постоянного пояснения; tooltip — «Выбранная папка откроется вместо текущей в этом окне VS Code». Изменён только этот пункт рабочего UX-файла, остальные пункты сохранены и не считаются принятыми. Проверен diff; макет и код не менялись.

Следующим решением пользователь сохранил существующее поведение плашки: нажатие раскрывает детали, открытие папки — отдельное действие. Пункт 2 удалён из UX-файла. Пункт 3 принят: «Последние диалоги», до трёх пассивных названий отдельными строками без маркеров, дат, постоянных пояснений, кнопочного оформления и hover-подсветки; интервалы уменьшить. Пункт 15 удалён. Вводное описание приведено в соответствие; остальные номера, принятое решение пункта 1 и уточнение пункта 13 сохранены. Проверен diff; макеты, ТЗ v2 и код не менялись.

Пункт 6 принят: «Мои папки с Kilo», рядом небольшой значок информации; tooltip — «Здесь собраны папки, в которых вы работали с Kilo. Чтобы вернуться к работе, выберите папку и откройте её.» Постоянный дополнительный текст не добавляется. Непринятое предложение пустого состояния удалено из пункта 6; остальные пункты не изменены. Проверен diff; макеты, ТЗ и код сохранены.

В UX-файл после пункта 17 добавлены принятые пункты 18–23: действие Проводника с tooltip без постоянного пояснения; путь только при наведении на имя папки; tooltip заголовка последних диалогов; названия диалогов в одну строку с многоточием и полным tooltip; одна visible missing-пометка с подробной подсказкой; refresh только значком ↻ с tooltip. В пунктах 9 и 10 добавлены короткие ссылки на уточнения 18 и 19. Проверены порядок и точные тексты; остальные решения, макеты, ТЗ и код сохранены.

Приняты пункты 7–9: текущая папка всегда первая, подпись «Сейчас открыта» и акцент независимы от раскрытия; открытие папки не меняет Kilo-активность; отдельное окно с пояснением только в tooltip; Проводник по пункту 18. Неактуальный пункт 10 удалён. В пункте 13 уточнено: относительная дата видна на свёрнутой плашке рядом с названием и сохраняется при раскрытии. Остальные правила и номера сохранены; diff проверен, макеты/код/ТЗ не менялись.

По точечному уточнению пользователя в пункте 7 UX-файла пометка заменена на «Вы сейчас здесь». Остальные правила пункта и документа сохранены; пункт 17 не менялся. Проверен diff; макеты и код не затронуты.

По разрешению пользователя выбрать простое правило принят пункт 13 UX-файла: календарные дни в локальном часовом поясе, точные диапазоны от сегодня до приблизительных месяцев/лет, время только сегодня, точная дата в tooltip. Отсутствующая, некорректная и будущая дата — «Дата неизвестна». Сохранены видимость на свёрнутой плашке и сортировка по точной активности. Проверены границы 0/1/2/6/7/13/14/20/21/29/30/59/60/364/365: пропусков и пересечений нет; сравнением подтверждена неизменность остальных пунктов, включая 17. Макеты и код не менялись.

### Два финальных эталона и ТЗ Step 2

По прямому запросу пользователя применены все UX-решения к исходным «Монограммам» (4 палитры) и «Тонким рамкам» (3 палитры). Пункт 17 принят: локальный аккордеон, короткое движение, reduced motion и компенсация прокрутки. Галерея: `D:\VSCode\KiloHub\desing\variants\index.html`; итоговое ТЗ: `D:\VSCode\KiloHub\desing\ТЗ реализации дизайна VSIX.md`. Для production предстоит выбрать одну из двух альтернатив; переключатель дизайнов не добавляется.

Удалены 20 других композиций и устаревшие вспомогательные файлы (33 файла по явному списку внутри variants). Первое массовое удаление отклонила автопроверка из-за риска зависимостей; оно не выполнялось. После подготовки новых зависимостей и их успешной проверки разрешено узкое удаление перечисленных ненужных файлов. Screenshots, требования, review и исходное ТЗ сохранены; v2 помечено историей, ссылки актуализированы. В прежнем review ссылки на удалённые CSS заменены историческими путями с сохранённым commit reference.

Проверки: `node desing/variants/build-final.mjs`, `node --check desing/variants/demo.js`, `node --check desing/variants/build-final.mjs`, `node --check desing/variants/activity.cjs`, `node desing/variants/verify-final.mjs`, `git diff --check`. Подтверждены две композиции/семь тем, ровно три HTML с галереей, локальные ссылки, структура и блокировка missing, отсутствие дат диалогов и видимой строки пути, граничные даты и current-first. Минимум расчётного контраста проверенных текстовых пар: original 5,54:1, dark 4,79:1, light 4,74:1, contrast 13,44:1. Ограничения и результат проверки: `reviews/design-final-two-review.md`.

Синтаксис и исходная логика аккордеона/scroll проверены без браузера; визуальная и клавиатурная приёмка, реальная плавность/позиционирование и пользовательские темы не подтверждены. Прежний запрет file URL/обходов соблюдён. Production, VSIX и kilo.db не менялись.

### Исправления повторного UX-аудита

По разрешению пользователя исправлены все шесть замечаний `reviews/design-ux-application-audit.md`: 35 полных путей, сохранение tooltip при focus/hover и Escape, очередь последнего намерения аккордеона, строгая календарная валидация ISO дат, ограничение tooltip viewport с прокруткой, обновление подписей на локальной полуночи/focus/visibility/refresh без перезаписи fixture timestamps. Анимация теперь 320 мс (вдвое медленнее), reduced motion — 0; UX пункт17 и итоговое ТЗ синхронизированы.

Пересобраны оба HTML; прошли `node --check` для demo.js/activity.cjs/interaction.cjs/build-final.mjs, `node desing/variants/verify-final.mjs`, `node desing/variants/verify-regressions.mjs`, `git diff --check`. Новые регрессии проверяют реальные helpers и tooltip handlers офлайн, не браузер. Подробности: `reviews/design-ux-fixes.md`. Текущий/новый выбор, дата и missing scope сохранены; production/VSIX/данные не тронуты. Браузерный рендер/scroll/клавиатурная приёмка по-прежнему не подтверждены; независимое ревью исправлений ожидается отдельно.

### Соразмерность шрифтов и размеров VS Code

По запросу пользователя сравнены реальный screenshot Step1 (2539×1445) и одобренная imagegen-иллюстрация (1662×946). Независимые измерения нормализованного шага строк (~5,5% ширины sidebar) и умеренного увеличения имён (~1,1–1,2× native glyph) учтены как отношения, не CSSpx. Исходный screenshot сохранён без изменений в `desing/screenshots/kilo-hub-step1-scale-reference.png`; иллюстрация `kilo-hub-inset-in-vscode-preview.png` не редактировалась.

Общий `desing/variants/scale.css` использует vscode-font-family/font-size/font-weight и fallback13px/400. Для7тем: действия/диалоги/tooltip1B, metadata12/13B, имена15/13B и16/13B, знаки32/13B и36/13B; отступы производны от B. Два дизайна сохраняют разные формы/палитры/плотность. Удалены прежние фиксированные product font-size и media-уменьшение текста, добавлены UXп24 и точная таблица финального ТЗ. Данные и JS не менялись, анимация320мс сохранена.

Проверки: генерация обоих HTML, verify-final.mjs, verify-regressions.mjs, verify-scale.mjs и git diff --check. Ширины260/320/400 и B13/16/20 проверены исходниками/арифметикой, не браузером. При260/B13 текстовая область≈138px у рамок и122px у монограмм (с условным резервом17px scrollbar). Результаты: `reviews/design-vscode-scale-review.md`. DPI/zoom исходника неизвестны; реальный рендер, screenshot-match и200% zoom ещё требуют ручной приёмки. Production/VSIX не менялись; fileURL policy не обходилась.

Независимая проверка CSS-каскада завершена без существенных findings; дополнительно проверен узкий стенд244px внутри viewport260 и contrast border. Реальный рендер остаётся непроверенным.

### Полная размерная спецификация финальных эталонов

По прямому запросу пользователя добавлено нормативное приложение `desing/design-size-spec.md`, связанное с финальным ТЗ и UXп24. Оно описывает все тексты, значки, отступы, рамки, скругления, адаптивные/content-dependent размеры, реальные ограничения tooltip и движение320мс для двух композиций/семи тем. Значения сверены с последовательностью stylesheet и JS inline-style; явно отделены размеры оболочки локального стенда от будущего Webview. Примеры при B13 включают фактическую однострочную кнопку28,2px и зависимость высоты карточки от содержимого. Макеты и production не менялись.

Проверены локальные ссылки приложения, арифметика размеров, `node desing/variants/verify-scale.mjs`, `node desing/variants/verify-final.mjs`, `git diff --check`. Проверки исходников и формул не подтверждают браузерную геометрию, UA-radius, scrollbar, glyph или runtime-приёмку. Визуальная проверка остаётся отдельным незакрытым этапом.

### Видимость действий по состоянию папки

В двух макетах/семи темах current содержит только второстепенный Проводник; missing не содержит кнопок и actions-контейнера, включая совпадение с current. У истории без действий нет лишних отступов и разделителя. Остальные доступные папки сохраняют три команды. Обновлены UXп25, финальное ТЗ и размерное приложение; Step1/production не изменены.

Проверены четыре сочетания состояния через renderActions и реальные карточки всех7тем; генерация, verify-final/regressions/scale и diff-check проходят. Отчёт: reviews/design-action-visibility.md. Визуальная/runtime-проверка остаётся непроведённой; значки этим изменением не затронуты.

### 16 устойчивых цветовых групп

Добавлены общий folder-colors.cjs (нормализация локального Windows-пути/FNV-1a/16hue/контраст) и folder-colors.js (реальная computed-поверхность, наблюдение темы, системный fallback). Значки окрашены в обоих дизайнах/всех7темах; статус не определяет группу. Геометрия и команды сохранены. В каждой панели16обезличенных папок с одинаковыми путями/порядком; имена с номерами детерминированно подобраны для полного покрытия16слотов, без обхода производственного алгоритма. Прокрутка вместо уменьшения размеров.

UX26, финальное ТЗ и размерное приложение обновлены. Проверки: verify-colors (112знаков, эквивалентные/невалидные пути,4096RGB×16слотов, минимум контраста букв7,70:1 и границ4,58:1; настоящий обработчик смены темы на офлайн DOM-дубле), verify-final/regressions/scale, синтаксис новыхJS, diff-check. Подробности reviews/design-folder-colors.md. Фактический браузерный рендер и смена темы VS Code не проверены, production/VSIX не изменены.

### Возврат исходной темы монограмм

По запросу пользователя возвращён только original/default внешний вид до d1ef061: старые mint/peach/lavender/blue и gray missing, прозрачная контрастная рамка знака вместо новой чёрной. Сохранены16примеров (цвета повторяются), размеры,320мс и всеUX. Остальные6панелей сохраняют16групп. Обновлены исключение UX26/ТЗ/размеры и verify-colors: original проверяется отдельно как16старых знаков, остальные96 —16слотов в каждой теме. Четыре verify-скрипта проходят; отчёт reviews/design-original-palette-restore.md. Браузер не использовался, production не менялся.

### Общая мягкая палитра значков

Следующее принятое уточнение отменяет исключение original: все112знаков/7тем используют16групп. Светлые заливки включают точные прежние mint/peach/lavender/blue; dark имеет приглушённые HSL24%/28%. Обычные темы имеют transparent-границу значка, без изменения размеров/рамок карточек. В HC граница нужна лишь при fill-to-surface<3. Missing сохраняет группу. Path hash и нормализация не менялись.

ТЗ/UX26/размеры обновлены без устаревших действующих исключений и обязательной резкой рамки. Verify-colors проверяет112знаков/16×7,4096RGB×16 (инициалы минимум6,24:1), normal transparent, HC-dark/HC-light и возврат normal, смену темы/сортировку на DOM-дубле; verify-final/regressions/scale проходят. Отчёт reviews/design-soft-colors.md. Browser/VSIX/runtime-визуальная приёмка не заявляется.

### Чередование цветовых семейств вместо градиента

Причина эффекта: fixtures покрывали слоты0–15 в порядке активности, палитра также шла по hue. Сопоставлен оригинал до d1ef061: mint→peach→lavender→blue. Добавлена фиксированная slotOrder=[1,6,12,9,15,5,2,13,8,0,10,3,14,7,11,4]. Состав мягкой палитры/хэш/нормализация не меняются; меняется только соответствие slot→цвет. Случайного shuffle или сортировки папок по цвету нет. Для произвольных путей похожие соседи остаются возможны.

Оба HTML отличаются от предыдущего коммита только inline-цветами знаков: пути/даты/порядок/действия сохранены. Verify-colors проверил16слотов×7тем и разрыв соседних demo-hue≥60°, контраст минимум6,24:1; verify-final/regressions/scale проходят. UX26/финальноеТЗ содержат принцип и точную перестановку. Отчёт reviews/design-mixed-color-order.md. Рендер не проверялся, production не тронут.

### Подсказки кнопок без перехвата мыши

UX27 реализован в обоих макетах/7темах: команды/refresh/info явно помечены data-tip-kind=button; их popup pointer-events:none/tabIndex−1, leave скрывает сразу. Pointer-induced focus не удерживает, Tab-focus удерживает до ухода/Escape. Длинные информационные подсказки сохранили hover/focus/прокрутку и grace120мс. ТЗ/размерное приложение согласованы с двумя режимами; задержка600мс/новое позиционирование не вводились.

Проверка verify-button-tooltips вызывает реальные handlers: immediate leave, соседняя кнопка, focus modality, Escape/aria, переключение long/simple и панели. Прежние verify-regressions/final/scale/colors проходят. Отчёт reviews/design-button-tooltips.md. Browser hit-testing/рендер не проверены, production не менялся.

### Tooltip только по наведению

Последнее уточнение UX27 отменяет focus-появление/удержание всех tooltip. Удалены focusin/focusout и modality-tracking из installTooltip, popup всегда tabIndex−1. Hover кнопок скрывается сразу, длинные подсказки сохраняют hover/мышиную прокрутку/grace120мс. Escape/aria-describedby cleanup сохранены; demo.js и клавиатурная активация/фокус элементов не менялись.

ТЗ/UX27/размеры согласованы с hover-only. Проверены focus-only no-popup, Tab не меняет owner, leave скрывает несмотря на фокус, long hover и cross-panel, прежние проверки цветов/дат/аккордеона. Отчёт reviews/design-hover-only-tooltips.md. Браузерная проверка не проводилась, production не тронут.

### Единая подсказка плашки без viewport-fit

UX28: .folder-head — единственный fullpath-owner в обоих состояниях. Date/missing/name не имеют вложенных tooltip; дата остаётся видимой, updateDates не возвращает data-tip. Переходы между потомками не перезаписывают popup и не запускают hide/timer. Позиция exact owner.left/bottom безclamp; width:max-content/max-width330px/max-height360px — контентные пределы, не fit-to-window. Reviewer заметил width:auto shrink-to-fit; устранено явным max-content.

Все5verify проходят:112head имеют ровно1owner, пути правильны, потомки стабильны, anchornear-edge не сдвигается, прежние mouse-only/actions/colors/dates/320мс сохранены. ТЗ/UX13/19/22/27/28 и размеры согласованы; Webview не сможет рисовать поверх соседнего VS Code, clipping принят как ограничение, host-поверхность не добавлена. Отчёт reviews/design-single-head-tooltip.md. Рендер не проверялся.

### Все подсказки исчезают при уходе с источника

До исправления воспроизведено owner→popup полного пути: hidden=false/pointer-events:auto. По последнему уточнению «как и везде» теперь ВСЕtooltip имеют pointer-events:none/tabIndex−1 и немедленный leave. Удалены типовые исключения, onTip и120мс; длинные тексты width:max-content/max-width330px/heightauto без scroll/maxheight. Stable-переходы внутриheader, Escape и unclampedanchor сохранены. HTML пересобраны, ненужные data-tip-kind убраны.

Обновлены UX27/28, финальноеТЗ и размеры без противоречащего hoverablelong. Профильный harness проверяет все прежние типы, owner→popup/owner→owner, отсутствие таймеров/focus, descendants/Escape/crosspanel; остальные4verify проходят. Отчёт reviews/design-instant-tooltips.md. Browser не использовался, production не менялся.

### Геометрическое попадание в popup

Воспроизведён случай pointer-events:none с owner под tooltip: прежде pointermove внутри прямоугольника не скрывал popup. Теперь общий capture-pointermove обработчик среды проверяет каждый видимый popup и скрывает его в том же событии при попадании clientX/Y (границы включены). Owner подавлен до настоящего leave/reentry, между потомками не появляется. Listener один на среду/окно для7панелей, повторная установка идемпотентна, отсоединённые панели убираются из списка наблюдения.

Проверены до/после, края rect, отсутствие перехвата pointer, panel-local dismissal и повторный вход. ТЗ/UX/размеры дополнены; остальные5verify проходят. Отчёт reviews/design-tooltip-geometry-dismiss.md. Не заявляется реальный browser hit-testing/рендер; production не тронут.

### Консолидация пакета Step 2: только монограммы

Пользователь окончательно выбрал монограммы. Единственный вход desing/START_HERE.md ведёт к каноническому desing/ТЗ реализации дизайна VSIX.md и нормативному design-size-spec.md. Вариантов на выбор больше нет; Step2production остаётся будущей работой. Все принятые UX, включая геометрическое скрытие tooltip, сверены с каноном: reviews/design-step2-consolidation.md.

В desing/old_donotuse перенесены6файлов: design-task.md, design-task-v2.md, UX правки.md, variants/README.md, variants/vscode-monograms/02-inset.html и screenshots/kilo-hub-inset-in-vscode-preview.png. Их содержимое сохранено, добавлен поясняющий README. Архив не является runnable dependency/requirements. Активны3реальных baseline-screenshot как evidence, выбранный HTML с4темами/64папками, галерея и необходимые CSS/JS/5проверок.

Генератор больше не создаёт другой дизайн; inset-CSS ветки убраны, размерный каскад сведён к тем же фактическим размерам монограмм. Все5verify проходят, verify-final проверяет локальные ссылки всего активного desing исключаяархив и запрещает активные зависимости наархив. Сравнены6archivepayload с прежними отслеживаемыми версиями. Реальный browser/VSIX/темы/клавиатурная приёмка не выполнены; ограничение Webviewtooltip сохраняется, production/reqStep1/БД не менялись.

### Перенос дизайн-пакета в нормативный Step 2

По прямому запросу пользователя папка `desing/` целиком перенесена в `req/step2/`. Канон: `req/step2/ТЗ реализации дизайна VSIX.md`; вход: `req/step2/START_HERE.md`; размерное приложение: `req/step2/design-size-spec.md`; последовательные ответы пользователя записываются в `req/step2/02-уточнение-ТЗ.md`. Старые упоминания `desing/` выше сохраняются как исторический журнал путей на момент соответствующей работы и не являются актуальными командами.

Feasibility-аудит завершён. Макеты визуально полностью приняты. Зафиксированы: две видимые строки без `Kilo Folders`, доступные tooltip, адаптация к пользовательским темам, обязательные повторные ревью до отсутствия findings и финальная ручная UI-проверка пользователем. Числовой performance SLA отложен; существующий read-only Kilo storage сохраняется в Step 2, собственное хранилище относится к будущему отдельному этапу. Обязательных открытых вопросов для ТЗ Step 2 не осталось.

### Нормативный пакет Step 2 готов к реализации

Синхронизированы канон, Уточнение ТЗ, размерное приложение, accessible tooltip reference, test matrix, manual checklist и `specs/step2-implementation-plan.md`. Первый цикл независимых ревью записан в `reviews/step2-spec-review-01.md`; найденные tooltip/header/current/monogram/theme/actions/testability противоречия устранены. Все шесть offline design verify, дополнительные tooltip regressions, `node --check`, локальные Markdown links и `git diff --check` проходят. На этом этапе production всё ещё соответствует Step 1 и VSIX `0.1.0`; реализация и release evidence Step 2 начинаются только после отдельного нормативного коммита.

### Baseline перед production Step 2

После normative commit `88ea354` из чистого tracked tree выполнены `NODE_TLS_REJECT_UNAUTHORIZED=1`, `npm ci`, audit, полный `npm test`, exact `verify:vsix` и `npm run test:installed`. Результат: audit `0 vulnerabilities`, 27/27 unit/subtests, development и installed Extension Host VS Code `1.105.1` exit `0`, fixture DB неизменна. Сохранённый Step 1 artifact `dist/kilo-hub-0.1.0-win32-x64.vsix`: 12857 bytes, SHA-256 `13AC15017C69D333E0B370770961473D1DC5FAEFD6459B7FD88BF15510F67743`. Повторная упаковка 0.1.0 не выполнялась после docs-only commits, чтобы не менять reproducible ZIP timestamp; exact archive и fresh bundle hashes проверены existing verifier.

### Production Step 2 и первый remediation cycle

Production Webview реализован коммитами `be3f25a` и `b324982`: presenter/current/date/monogram/color, protocol/state/revision, host `WebviewViewProvider`, CSP HTML, browser DOM, accordion, accessible tooltip, themes, authorization и component/integration tests. Первый независимый production review cycle записан в четырёх отчётах `reviews/step2-production-*.md`; исходный результат: 1 Blocker, 10 High, 20 Medium, 6 Low с пересекающимися findings.

Remediation устраняет chunked render/heartbeat, action-time current/revision/path race, canonical realpath target, lifecycle generations, browser-ready installed handshake, adapter/protocol resource budgets, persistent metadata cache, CSP/local assets, focus/tooltip/theme/date/CSS gaps, minimum/current test-host isolation и package verifier/repro/negative orchestration. Текущий automated evidence до remediation commit: TypeScript/ESLint pass, unit 57/57, component 29/29, bundle scan pass, Extension Host VS Code `1.105.1` и `1.138.0` exit `0`, audit `0 vulnerabilities`, runtime dependencies отсутствуют. Clean `vsce ls` содержит только package/license, host+worker, `build/webview/webview.js`, `build/webview/webview.css`, release notes и icon. VSIX `0.2.0` ещё не собран; package/repro/install evidence остаётся pending до clean remediation commit и повторных review.

Targeted re-review первого remediation commit подтвердил исправление всех исходных Requirements/Accessibility findings; новый Low `History h3` исправлен. Дополнительный security/testability набор закрыл SQL native-sort/resource budget, filesystem outstanding-probe bound, общую Output sanitization, fail-closed resolved-view/browser-ready gate, current Stable test-host stability, два независимых release cycles, exact Node engine/negative verifier и полную test/manual traceability. Повторный merged gate после этих исправлений: unit 60/60, component 29/29, minimum VS Code `1.105.1` и Current `1.138.0` exit `0`, audit `0 vulnerabilities`. Package Blocker остаётся единственным ожидаемым gate до clean VSIX `0.2.0`.

Второй targeted pass нашёл только остаточные cases внутри тех же findings: timestamp BLOB, late path rejection, warning-channel path, history heading/reference и traceability IDs. Они закрыты отдельными SQL/type/limit guards, bounded semaphore regression, warning sanitizer boundary, синхронизированным `h2` reference и точной evidence-картой. Финальный source gate после исправлений: unit 62/62, component 29/29, full `npm test`, minimum/current Extension Host и шесть design verifiers — PASS. Следующий этап: clean source re-review commit, затем фактический `npm run release` и package review по одному SHA-256.

### Финальный Step 2 release

Source review exit достигнут; package/release review `0/0/0/0`, verdict `PACKAGE/RELEASE APPROVED`. Нормативный `npm run release` выполнил два независимых secure-TLS clean cycles (`npm ci`, audit, clean, full test, package) с одинаковым SHA-256, Current development gate, четыре negative verifier cases и installed minimum/current gates. Exact artifact: `D:\VSCode\KiloHub\dist\kilo-hub-0.2.0-win32-x64.vsix`, `31547` bytes, SHA-256 `69D380ADC18BE9DC4CE25BB8266E19B46078613AB4057A5C5ABA970FDAB607C2`, source commit `48d5884b2e364ccaeecc8e1e3d09baf1711c62a9`. Основной профиль VS Code успешно обновлён до `local.kilo-hub@0.2.0`. Полный evidence: `docs/step2-verification.md`; пользовательская проверка: `docs/step2-user-acceptance.md`. До результата пользователя визуальная/NVDA/manual action приёмка остаётся `Не проверено`, но plugin установлен и готов к финальному пользовательскому тестированию.

### Визуальный hotfix `0.2.1`

Пользовательская проверка установленного `0.2.0` выявила два blocking-дефекта: у всех карточек отображались взаимоисключающие подписи `Вы сейчас здесь` и `Папка не найдена`, а суммарные горизонтальные поля Webview и production layout чрезмерно сужали карточки. Причина первого дефекта — author rules с `display: block`, которые перекрывали browser presentation атрибута `hidden`; причина второго — стандартный `body` padding Webview поверх внутреннего `--hub-row-x`.

В рабочем дереве добавлен `[hidden] { display: none !important; }`, внешний `body` padding сброшен в `0`, full-width/minmax constraints заданы для panel/list/card/detail/actions, а внутренний gutter `--hub-row-x` сохранён. Рамка относится к каждой `.folder`, а не ко всей `.hub`. Версия и release metadata обновлены до `0.2.1`. Full `npm test` после version bump прошёл: unit `62/62`, component `29/29`, bundle scan и Extension Host VS Code `1.105.1` exit `0`; ESLint, TypeScript и `git diff --check` проходят. Независимое source review: `Blocker 0 / High 0 / Medium 0 / Low 0`. Воспроизводимая упаковка, VSIX `0.2.1`, установка и повторный visual verdict выполняются после отдельного чистого hotfix commit; `0.2.0` остаётся только историческим evidence.

Source commit `01d0d63eaa3614c5400c7b8c8a57a4c0ff01248f` прошёл два идентичных release cycles, exact/negative verifier и installed smoke на VS Code `1.105.1`/`1.138.0`. Артефакт `D:\VSCode\KiloHub\dist\kilo-hub-0.2.1-win32-x64.vsix`: `31872` bytes, SHA-256 `DD07D751D064695626F76E7D001038FD59D865338E975BF8A8F4D209004AC3AA`; основной VS Code `1.138.0` показывает `local.kilo-hub@0.2.1`. Артефакт зафиксирован release commit `d9089e3`.

### Step 3: нормативный пакет

Gate A завершён для начала B: независимое рассмотрение DB-04/SYNC-05 подтвердило допустимость row-scaled admission и явного resource-error без скрытого skip. Прежнее требование константного малого native budget было избыточной трактовкой, не пользовательским требованием. `docs/step3-resource-policy.md` фиксирует preflight, оценку/reserve, отсутствие blacklist, rollback/last-good/retry, бюджеты и остаточный native OOM риск. Admission probe 7/7 на bundled minimum/current: то же поле сначала отклонено до extraction, затем полностью обработано при восстановлении бюджета. Продуктовый scope/стек не менялись; production recovery/lifecycle проверяются в B перед C.

Третий discovery цикл (22 сентября): multi-process fenced writer и независимый Windows pipe ownership прошли на bundled minimum/current. JSON extraction подтвердил корректный BLOB-путь, обнаружил усечение TEXT на первом NUL в minimum; 100000 parts и 12 MiB поля полностью сверены с oracle. Конкретный блокер Gate A: малый substr не ограничивает native allocations исходного JSON, node:sqlite не предоставляет incremental BLOB API, Worker.resourceLimits это не исправляет. Whole 12 MiB processing даёт ~143.5/168.6 MiB maxRSS; resource-error сохраняет last-good, но не доказывает полноту произвольной истории. Не вводился скрытый лимит/skip поля, не менялась нормализация или стек. Нужно решение по row-scaled resource contract/изоляции либо incremental API; подробности в `docs/step3-writer-design.md`. Production не начат, установленный VSIX не менялся. Исследовательские файлы остаются незакоммиченными.

21 сентября 2026 года, 21:54 UTC: пользователь подтвердил согласование после предложения SQLite + встроенный node:sqlite + Worker Threads + FTS5 trigram/точный instr. Блокер отдельного согласования стека снят. Для неизвестного/смешанного формата действует безопасный отказ DB-09, а не молчаливое усечение истории; новый adapter не реализуется без отдельного контракта. Остальные проверки Gate A автоматически завершёнными не считаются: concurrent-host lifecycle/fenced writer, byte budgets/длинные поля/cold cache ещё требуют завершения. Production не изменён.

Второй discovery цикл: disk/WAL search probe прошёл на bundled minimum/current (45 cases/450 oracle comparisons, 24 invalid/reset); запросы от трёх символов, NUL требует instr вместо MATCH, FTS не быстрее scan на частых токенах. Реальное тестовое Extension Host расширение подтвердило startup без панели и общее globalStorageUri между Default/A/B; другой user-data root изолирован. Source routing подтверждает legacy у обычного VS Code чата, но отдельный новый API не гарантирует legacy-зеркало. Synthetic metadata-only ambiguity guard 8/8 на обоих runtime. Нельзя обещать полную историю смешанной БД с DB-06 без согласования границы совместимости. Full baseline npm test PASS (62/29/minimum host), probes не являются installed Step 3 acceptance. Gate A остаётся открыт; production/стек не утверждены. Подробности и команды: `docs/step3-discovery.md`.

Уточнение поиска: минимум 3 Unicode code points в каждом нормализованном токене. При коротком токене Enter не запускает поиск, показывает пояснение и сохраняет предыдущий применённый запрос/выдачу; пустой запрос по-прежнему сбрасывает фильтр. ТЗ/acceptance/план обновлены, измерения 1–2 символов оставлены в discovery как историческое evidence, не production-требование. Код не менялся.

Первый synthetic discovery цикл выполнен: `tests/discovery/step3-search.cjs` (1000 папок/10000 titles/100000 реплик, 42 cases/345 assertions на bundled Code minimum/current), `tests/discovery/step3-sync.cjs` (9/9 на standalone и обоих bundled runtime). FTS5 trigram есть, но требует instr/fallback для коротких запросов и проигрывает на частых подстроках. Legacy read-only/WAL/rollback/delete/archive/reset/hardlink/crash сценарии прошли; реальных данных не читали. Source research VS Code подтвердил общий default-profile globalStorageUri для разных профилей одного user-data root. Обнаружен новый session_message формат Kilo: до реализации нужно доказать полноту adapter. Полный baseline `npm test` после исправления lint probes PASS (62 unit/29 component/minimum host). Gate A не закрыт: actual Extension Host profile/activation, новый формат, disk/concurrency/cancellation/budgets ещё pending; production и стек не изменены. Подробности в `docs/step3-discovery.md`.

Нормативный пакет и актуальные правила зафиксированы commit `3bced9a` (`docs: define Step 3 requirements and agent workflow`). Следующий этап — завершение discovery по Gate A; production базы и выбор стека не начаты. Отдельные файлы Step 4 остались вне коммита; общий handoff сохраняет ранее записанную справку об отложенном Step 4.

Порядок уточнён пользователем: сначала актуализация `agents.md`, затем commit нормативного пакета, затем дальнейшее исследование. Правила обновлены: текущий scope Step 3, production-импорт только допустимого user text после Gate A, discovery без личной переписки, строго read-only источник, writable только изолированная база Hub, отдельное согласование стека и отложенный Step 4. Старый запрет metadata-only снят только для разрешённого runtime Step 3; он не разрешает агентам читать личные сообщения при исследовании.

Дополнение DOC-01–04: в Step 3 включено русское пользовательское описание вкладки Details вместо «No README available», канонический текст `docs/extension-description.md` подключается как README при упаковке. Exact/negative verifier и installed visual check должны проверять README и его актуальность. В `agents.md` добавлено постоянное правило обновлять описание, manifest description и release notes после значимых доработок. Само описание и изменение упаковки ещё не реализованы; текущий VSIX не менялся.

Уточнение пользователя: текущую доступную локальную папку без допустимых диалогов показывать временной первой карточкой с отметкой «Пока без диалогов Kilo». В раскрытии только пояснение о появлении истории после общения с Kilo. OPEN-04/05 фиксируют отсутствие записи в историю, lifecycle workspace/reload/first session, отсутствие дубликатов и отличие неизвестного состояния от подтверждённого отсутствия истории. При активном поиске сохраняется ранее согласованная фильтрация current по совпадению имени. План и acceptance matrix синхронизированы; production не менялся.

21 сентября 2026 года записаны `req/step3/01-requirements.md`, `req/step3/02-acceptance.md`, предварительный `docs/step3-discovery.md` и `specs/step3-implementation-plan.md`. Порядок: discovery → отдельное согласование стека → собственная база/фон → поиск/UI → выпуск. Стек НЕ утверждён, production не изменён. Приняты вся допустимая история, user text без synthetic/ignored, локальная база без дополнительного шифрования/согласий/управления, автоматическое обновление примерно каждые 10 секунд, удаление по успешной сверке, last-good при ошибках. Поиск по Enter: AND-подстроки по имени/всем title/репликам одной папки, без path, цитат и пометок. Плюсик выбирает существующую папку и открывает здесь; ручного реестра нет. Сохраняются три tooltip: info, плюсик, путь над именем.

Discovery исходников Kilo v7.7.5: session.time_updated не покрывает все изменения, журнал per-session удаляется вместе с session; нужны reconciliation и проверки synthetic fixtures. Личная переписка не читалась. Правила проекта актуализированы по решению пользователя; runtime discovery, согласование стека, реализация и проверки Step 3 pending.

Проверка нормативного пакета Step 3: независимое read-only review без замечаний (`reviews/step3-specification-review.md`), `git diff --check` PASS. Runtime-тесты не запускались: изменения только документационные.

### Tooltip hotfix `0.2.2`

Последующее решение пользователя: выпуск `0.2.3` оставляет только hover полного пути на тексте имени папки. Все остальные registrations удалены, полный path остаётся ARIA-описанием head без popup на focus. `.folder-name` стал inline, чтобы пустое место строки не расширяло hit area. Добавлен package icon `resources/kilo-hub.png`, взятый из установленного Kilo Code `7.7.5` (`assets/icons/logo-outline-black.png`); Activity Bar SVG не изменён. Проверки и выпуск `0.2.3` выполняются отдельно от исторического evidence ниже.

Выпуск `0.2.3` завершён из source commit `1367f15`: `npm run release` выполнил два идентичных clean/full/package цикла, audit (0 vulnerabilities), exact/negative verification, development и installed проверки VS Code `1.105.1`/`1.138.0`. Артефакт: `D:\VSCode\KiloHub\dist\kilo-hub-0.2.3-win32-x64.vsix`, `33782` bytes, SHA-256 `8F73194023B4DA6CB1136BB42B5A9421017C3157F8627CCDF2467677D2F31C9B`. Независимое package review: `0/0/0/0`, 11 exact entries, 4 bundle hashes и 2 icon hashes совпадают. Команда основного VS Code `--install-extension ... --force` успешна, `--list-extensions --show-versions` подтверждает `local.kilo-hub@0.2.3`. Визуальная приёмка и подтверждение reload остаются ручными; очень длинный popup ограничен физической поверхностью Webview, полный path доступен через ARIA.

По новой пользовательской проверке удаляются tooltip заголовка `Последние диалоги` и отдельных названий диалогов. Остальные popup становятся pointer-pass-through и немедленно скрываются при попадании координат pointer внутрь или на границу их геометрии; повторный показ заблокирован до реального ухода с owner. Полный title диалога сохраняется один раз в accessibility tree. УТЗ-09, каноническое ТЗ, size spec, test matrix и manual checklist синхронизированы. Full `npm test`: unit `62/62`, component `29/29`, bundle scan и minimum Extension Host PASS; audit `0 vulnerabilities`. Три цикла независимого review закрыли исходные `High 1 / Medium 2`, затем документационные `Medium 1 / Low 1`; финальный verdict `SOURCE REVIEW APPROVED`, `0/0/0/0`. Package/install `0.2.2` pending.

Source commit `3de628bf5adf310cb0c41b3ba34a0acd08091f98` прошёл нормативный `npm run release`: два независимых clean/full/package cycles дали одинаковый VSIX, Current development gate, четыре negative verifier cases и installed minimum/current gates прошли. Exact artifact: `D:\VSCode\KiloHub\dist\kilo-hub-0.2.2-win32-x64.vsix`, `31874` bytes, SHA-256 `A30F07223BFAADC49396B5C229429C7D636C069A288B440D9A94AA2C2EAB5986`. Финальный package review: `0/0/0/0`, `PACKAGE/RELEASE APPROVED`. Основной VS Code `1.138.0` успешно обновлён с `--force` и показывает `local.kilo-hub@0.2.2`. Последний pending operational step — `Developer: Reload Window`; после него требуется пользовательский visual verdict.

### Step 4: предварительная задача поддержки macOS

21 сентября 2026 года создан отложенный нормативный пакет `req/step4/`: `README.md`, `01-requirements.md`, предварительное исследование `docs/step4-preliminary-discovery.md` и план `specs/step4-implementation-plan.md`. Цель — функциональная эквивалентность завершённому Step 3 на native `darwin-arm64` и `darwin-x64` без регрессии Windows; Rosetta остаётся отдельным непредполагаемым сценарием.

Текущее исследование выполнено только по Windows production `0.2.3` и незавершённому нормативному Step 3. Оно подтвердило Windows-only guards/path identity/packaging/tests и предварительную переносимость Webview/protocol/state/Worker/встроенного `node:sqlite`, но не является разрешением реализации. Step 3 добавит writable Hub DB, migrations/rebuild, source/Hub file identity, multi-window writer coordination, background sync, search runtime и recovery, поэтому объём Step 4 должен быть пересчитан по фактическому результату Step 3.

В `specs/step4-implementation-plan.md` задан блокирующий Gate 0: после выпуска Step 3 зафиксировать source commit, exact VSIX/SHA-256, schema/migration и runtime contracts, затем полностью повторить macOS discovery на реальных arm64/x64 средах до первого production commit Step 4. Изменение Step 3 в storage/path/SQLite/search/worker/sync/locking/recovery/package либо поддерживаемых Kilo/VS Code/macOS/runtime/toolchain возвращает затронутые области на повторное исследование. Один platform-neutral или отдельные platform-specific VSIX выбираются только этим gate; Rosetta требует отдельного evidence. Production-код, текущий VSIX и Kilo data этой постановкой не изменены; все runtime/package/manual проверки Step 4 pending.
