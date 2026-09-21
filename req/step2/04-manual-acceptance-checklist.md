# Step 2 — ручной чек-лист приёмки установленного VSIX

## Правила прогона

Чек-лист выполняется на установленном production VSIX, а не на локальном HTML-макете или Extension Development Host. Все обязательные строки относятся к одному source commit и одному SHA-256. Для destructive/open-window сценариев используется disposable workspace и обезличенная копия fixture; рабочую `kilo.db` не изменять.

Допустимые значения результата: `Пройдено`, `Не пройдено`, `Блокировано`, `Не применимо`. Пустой результат означает `Не проверено`. В evidence указываются screenshot/video/log/output/announcement и путь к артефакту, а не только слово «проверено».

## Паспорт прогона

| Поле | Значение |
| --- | --- |
| Дата и локальный часовой пояс | |
| Исполнитель | |
| Роль исполнителя | |
| Source commit, полный SHA | |
| Git status исходного checkout | |
| VSIX path | `dist/kilo-hub-0.2.3-win32-x64.vsix` |
| VSIX SHA-256 | |
| Размер VSIX, bytes | |
| Результат exact verifier | |
| VS Code version/commit/architecture | |
| Kilo Code version | |
| Windows version/build | |
| Windows display scaling | |
| Мониторы и разрешение | |
| Screen reader | NVDA, версия: |
| Fixture/source description | |
| Built-in dark theme ID | |
| Built-in light theme ID | |
| Built-in dark high-contrast theme ID | |
| Built-in light high-contrast theme ID | |
| Custom dark theme ID, best effort | |
| Custom light theme ID, best effort | |

Точные идентификаторы тем записываются из фактически установленной версии VS Code. Обязательный scope состоит ровно из четырёх встроенных классов: dark, light, dark high contrast и light high contrast. Custom themes проверяются как best effort и не расширяют обязательную гарантию контраста.

## Установка и provenance

| ID | Действие и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-PKG-01 | SHA-256 вычислен после exact verifier; имя/manifest version равны `0.2.3`, target `win32-x64`; hash совпадает во всех дальнейших отчётах. | | | |
| M-PKG-02 | Exact verifier подтверждает полный allow-list, hashes host/browser assets и обеих иконок `resources/kilo-hub.png`/`resources/hub.svg`, неизменность hub.svg и отсутствие demo/tests/fixtures/requirements/reviews/source maps/DB sidecars. | | | |
| M-PKG-03 | VSIX установлен с `--force` в пустые изолированные `--user-data-dir` и `--extensions-dir`; список extensions показывает ровно ожидаемый identity `@0.2.3`. | | | |
| M-PKG-04 | После restart VS Code Hub активируется, browser assets загружаются без blank view, 404, CSP error и внешних network requests. | | | |
| M-PKG-05 | Packaged worker выполняет первый metadata-only refresh; Output не содержит activation/runtime error. | | | |
| M-PKG-06 | Страница расширения показывает PNG `resources/kilo-hub.png`, на него ссылается manifest `icon`; Activity Bar использует прежний `resources/hub.svg` без изменения вида или назначения. | | | |

## Визуальная оболочка и размеры

Для каждой строки повторить нужные комбинации и записать Windows scaling. Zoom меняется штатной командой VS Code; inverse-scale не используется.

| ID | Ширина / zoom | Ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- | --- |
| M-SCALE-01 | 260 CSSpx / 100% | Ровно две верхние строки: native `Kilo Hub` и `Мои папки с Kilo`; нет `Kilo Folders` и DOM-дубликата; горизонтальной прокрутки нет. | | | |
| M-SCALE-02 | 320 CSSpx / 100% | Имя имеет приоритет, длинное имя переносится, дата/current/missing читаемы, диалог ellipsis, кнопки не обрезаны. | | | |
| M-SCALE-03 | 400 CSSpx / 100% | Геометрия соответствует утверждённым монограммам, размеры не растянуты искусственно, список использует доступную высоту. | | | |
| M-SCALE-04 | 260 CSSpx / 200% | Нет горизонтального scroll; контент остаётся доступен вертикальной прокруткой; focus не обрезан, tooltip не имеет внутреннего height clipping и сохраняет полный ARIA-текст при физическом clipping Webview. | | | |
| M-SCALE-05 | 320 CSSpx / 200% | Длинные имя/path/title доступны, карточки и кнопки не перекрываются. | | | |
| M-SCALE-06 | 400 CSSpx / 200% | Нет inverse zoom/font shrink; порядок, Tab и scroll сохраняются. | | | |
| M-SCALE-07 | Все ширины при зафиксированном Windows scaling | Фактический scaling записан; glyph, scrollbar и focus не обрезаны. | | | |

## Темы и цвета

| ID | Сценарий и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-THEME-01 | Built-in dark theme с записанным ID: тексты/действия/status/focus читаемы; монограммы мягкие, инициалы контрастны; статус не выражен только цветом. | | | |
| M-THEME-02 | Built-in light theme с записанным ID: те же проверки. | | | |
| M-THEME-03 | Built-in dark high contrast с записанным ID: системные цвета, focus/current/missing и условная граница монограммы различимы. | | | |
| M-THEME-04 | Built-in light high contrast с записанным ID: те же проверки. | | | |
| M-THEME-05 | Переключить четыре встроенные темы без reload: UI обновляется, path→color group не меняется, stale styles отсутствуют. | | | |
| M-THEME-06 | Windows forced colors: системная читаемость и focus сохранены, `forced-color-adjust` не подавляет режим. | | | |
| M-THEME-07 | Custom dark theme, best effort: semantic tokens применены; функциональной невидимости элементов нет; отклонение контраста документируется, но не выдаётся за гарантию. | | | |
| M-THEME-08 | Custom light theme, best effort: те же проверки. | | | |

## Данные, presenter и состояния карточек

| ID | Сценарий и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-DATA-01 | Отображены только folders с допустимой Kilo-историей; child/archive/UNC/Remote/WSL/Dev Container/`.code-workspace` исключены. | | | |
| M-DATA-02 | Папка без Kilo-истории, даже текущая в VS Code, не добавлена. | | | |
| M-CURRENT-01 | Current с Kilo-историей первая независимо от старой активности; видна подпись `Вы сейчас здесь`, сохраняющаяся при раскрытии. | | | |
| M-CURRENT-02 | Простое раскрытие и открытие папки не меняет отображаемую Kilo-активность. | | | |
| M-DATE-01 | `Сегодня, чч:мм`, `Вчера`, representative week/month/year labels и `Дата неизвестна` соответствуют fixture; дата не имеет отдельного tooltip. | | | |
| M-DATE-02 | Known timestamps идут по точному времени, unknown после known; равные элементы имеют стабильный порядок до/после refresh. | | | |
| M-MONO-01 | Инициалы соответствуют имени, имя объявляется отдельно, decorative badge не дублируется screen reader; одна папка сохраняет цвет при refresh/status/theme changes. | | | |
| M-HISTORY-01 | В раскрытии показано не более трёх последних title, новые выше; пустой title=`Без названия`; строки пассивны и Enter их не открывает. | | | |
| M-HISTORY-02 | Длинный title имеет ellipsis; у заголовка и названий нет tooltip, `tabindex` и hover action; полный title остаётся доступен screen reader один раз. | | | |
| M-MISSING-01 | Missing остаётся в истории с одной пометкой `Папка не найдена`, path tooltip и диалогами; нет действий, actions container, лишнего отступа или разделителя. | | | |
| M-MISSING-02 | Сочетание current+missing следует missing: нет ни одной action; состояние понятно без цвета. | | | |

## Клавиатура, NVDA и ожидаемые объявления

NVDA запускается до открытия Hub. Фиксируются дословное или эквивалентное объявление, имя, роль и состояние; различия синтезатора допустимы, потеря смысла нет.

| ID | Действие | Ожидаемое объявление/поведение | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- | --- |
| M-A11Y-01 | Tab на info | Доступное имя соответствует полному пояснению `Здесь собраны папки…`; визуального popup нет. | | | |
| M-A11Y-02 | Tab на refresh | Объявлено `Обновить список папок и диалогов из Kilo`, роль button; busy/disabled объявляется во время чтения; визуального popup нет. | | | |
| M-A11Y-03 | Tab на collapsed folder head | Объявлены имя папки, роль button и состояние `свёрнуто`; current/missing текст доступен; декоративные инициалы не дублируются; полный path доступен через постоянный `aria-describedby`, визуального popup нет. | | | |
| M-A11Y-04 | Enter на folder head | Детали открыты; объявлено `развёрнуто`; `aria-controls` ведёт к видимым деталям. | | | |
| M-A11Y-05 | Space на том же head | Детали закрыты; объявлено `свёрнуто`; скрытые descendants отсутствуют в Tab-порядке. | | | |
| M-A11Y-06 | Закрыть карточку, когда focus в action | Фокус переводится на видимый логичный элемент, не остаётся внутри inert/hidden блока. | | | |
| M-A11Y-07 | Tab по available non-current actions | Последовательно объявлены три точных action names; видимый focus не обрезан; визуальных popup нет. | | | |
| M-A11Y-08 | Tab по current available | Доступен только `Показать файлы папки`; две open-команды не попадают в Tab. | | | |
| M-A11Y-09 | Tab по missing | Ни одна action не попадает в Tab; история остаётся читаемой. | | | |
| M-A11Y-10 | Initial loading / refreshing / initial error / refresh error | Изменение busy/status объявляется без чрезмерного повтора; stale data явно обозначены при refresh error. | | | |
| M-A11Y-11 | Две папки с одинаковым именем | Постоянный `aria-describedby` кнопки head даёт полный путь без мыши в collapsed/expanded состояниях; focus не показывает popup, `.folder-name` не создаёт отдельный Tab-stop. | | | |

## Tooltip

УТЗ-10 имеет приоритет над УТЗ-05/09 и прежним набором owners. От УТЗ-09 сохраняются `pointer-events:none` и немедленное geometry dismissal. При проверке focus без hover указатель находится вне текста имени.

| ID | Сценарий и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-TIP-01 | Hover именно текста `.folder-name`: полный path показан немедленно в collapsed/expanded/current/missing; свободное место строки имени и остальная площадь `.folder-head` popup не показывают. Проверить короткое и многострочное имя. | | | |
| M-TIP-02 | Keyboard focus head: полный path доступен через постоянный `aria-describedby` без визуального popup; focus/blur сами не показывают и не удерживают tooltip. | | | |
| M-TIP-03 | Перевести pointer внутрь или на границу прямоугольника popup, включая текст имени под popup: он исчезает в том же событии, не перехватывает pointer/click и не появляется повторно до реального leave/reentry текста имени, независимо от focus. | | | |
| M-TIP-04 | Escape: popup закрывается, устойчивый `aria-describedby` head и текущий focus сохраняются; движение над именем не открывает popup до реального leave/reentry. | | | |
| M-TIP-05 | Уход с текста имени на mono/date/current/missing/стрелку/свободное место head или popup немедленно закрывает подсказку без grace, даже при focus head. Возврат на текст имени разрешает новый показ. | | | |
| M-TIP-06 | Hover/focus info/refresh/трёх actions/head вне текста имени/date/mono/history/conversations/current/missing/стрелки не показывает custom или native title popup; доступные имена кнопок и полный title диалога сохранены. Пассивные элементы не получают Tab-stop ради проверки. | | | |
| M-TIP-07 | Текст `.folder-name` у правого/нижнего края, width 260 и zoom 200%: popup привязан к тексту имени, позиционируется с viewport margin, не имеет внутреннего height clipping; физически обрезанный Webview текст полностью доступен через `aria-describedby` кнопки head. | | | |
| M-TIP-08 | Scroll/resize/theme change при открытом tooltip: позиция корректируется, popup не получает внутреннего height clipping; физическое clipping Webview соответствует M-TIP-07. | | | |

## Аккордеон, motion, scroll и focus

| ID | Сценарий и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-ACC-01 | Click/Enter/Space открывают ровно одну карточку; повторное действие закрывает её; открытие B закрывает A. | | | |
| M-ACC-02 | Быстрая серия A→B→B и повторные toggles: финал соответствует последнему намерению, промежуточная высота не застревает. | | | |
| M-ACC-03 | Normal motion: переход около нормативных 320 ms воспринимается непрерывно; после него inline height не ломает layout. Число используется как контракт duration, не performance SLA. | | | |
| M-ACC-04 | `body.vscode-reduce-motion`/Windows reduced motion: движение отсутствует, состояние и scroll compensation сохраняются. | | | |
| M-ACC-05 | Раскрытие в середине длинного списка удерживает head по возможности под курсором; details показываются минимальным scroll без прыжка наверх. | | | |
| M-ACC-06 | Раскрытие последней карточки учитывает край scroll container; невозможная компенсация корректно ограничена. | | | |
| M-ACC-07 | Refresh сохраняет expanded ID, focus и scroll, если папка существует; при её удалении безопасно сбрасывает их на существующий элемент. | | | |

## Refresh, ошибки и восстановление

Ошибки индуцируются только через изолированную fixture/configuration; production `kilo.db` не переименовывать, не блокировать записью и не изменять.

| ID | Сценарий и ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-REF-01 | Первый load: `Загружаем папки…`, busy; повторный refresh недоступен; success атомарно показывает список. | | | |
| M-REF-02 | Empty success: `Здесь пока нет папок с диалогами Kilo`; refresh доступен; нет предложения ручного добавления. | | | |
| M-REF-03 | Медленный refresh: прежний список остаётся, показано `Обновляем список…`, повторные клики не запускают параллельные чтения. | | | |
| M-REF-04 | Success после refresh удаляет исчезнувшую session и опустевшую folder; раскрытие существующей folder сохраняется. | | | |
| M-REF-05 | Initial error: `Не удалось загрузить папки. Попробуйте обновить список`; technical detail только в Output; retry восстанавливает view. | | | |
| M-REF-06 | Refresh error: прежний список остаётся; `Не удалось обновить список. Показаны ранее загруженные данные`; данные не выдаются за свежие. | | | |
| M-REF-07 | Следующий success после refresh error снимает stale/error state и заменяет snapshot без дублей. | | | |

## Действия папок

Использовать disposable окна. `Open Here` штатно завершает текущий Extension Host при замене workspace.

| ID | Состояние / действие | Ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- | --- |
| M-ACT-01 | Available non-current / `Открыть в этом окне` | Открывается выбранная fixture-folder вместо текущей в том же окне; hover/focus не показывает popup. | | | |
| M-ACT-02 | Available non-current / `Открыть в отдельном окне` | Текущая папка остаётся, fixture-folder открывается в новом окне; hover/focus не показывает popup. | | | |
| M-ACT-03 | Available non-current / `Показать файлы папки` | Windows Explorer открывает именно проверенную fixture-folder; hover/focus не показывает popup. | | | |
| M-ACT-04 | Available current | В DOM/Tab только secondary Explorer action; обе open-команды отсутствуют. | | | |
| M-ACT-05 | Missing non-current | Все actions и их контейнер отсутствуют; activation невозможна. | | | |
| M-ACT-06 | Missing current | Missing приоритетнее current; все actions отсутствуют. | | | |
| M-ACT-07 | Folder удалена после render до action | Host повторно валидирует snapshot/path, ничего не открывает, показывает безопасную понятную ошибку. | | | |
| M-ACT-08 | Быстрый refresh сменил revision до action | Stale action не исполняется против нового snapshot; нет произвольной команды/path. | | | |

## Безопасность и границы scope

| ID | Сценарий | Ожидаемый результат | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- | --- |
| M-SEC-01 | Обезличенная fixture содержит `<script>`, `<img onerror>`, quotes, bidi/control и `javascript:` в name/path/title | Значения видимы только как текст; script/img/handler не создаются, действий и переходов не возникает. | | | |
| M-SEC-02 | Открыть DevTools Console/Network при загрузке, refresh, раскрытии, tooltip и смене темы | Нет CSP violations, 404 browser assets и внешних network requests от Kilo Hub. | | | |
| M-SCOPE-01 | Осмотреть установленный UI и contributions | Нет поиска, избранного, copy path, ручного реестра/цветов, открытия диалога, auto watcher, telemetry, LLM или собственного storage. | | | |

## 1000 sessions без числового SLA

| ID | Сценарий и ожидаемые инварианты | Evidence | Результат | Исполнитель |
| --- | --- | --- | --- | --- |
| M-PERF-01 | Загрузить fixture из 1000 sessions: Extension Host остаётся интерактивным; все допустимые folders представлены; нет duplicate/lost folders. | | | |
| M-PERF-02 | Проверить current-first, точную сортировку, не более трёх отображаемых dialogs, stable colors и action-state на большой fixture. | | | |
| M-PERF-03 | Refresh/accordion/keyboard/scroll работают без наблюдаемого зависания и не запускают параллельные reads. Фактическое время можно записать как диагностику, но pass/fail numeric SLA не вводится. | | | |

## Итог и review exit

| Поле | Значение |
| --- | --- |
| Все обязательные manual cases завершены | |
| Pixel-level/субъективная визуальная приёмка пользователя | |
| Automated suite на том же commit | |
| Exact verifier на том же VSIX hash | |
| Обязательные review-области завершены | |
| Открытые Blocker | |
| Открытые High | |
| Medium dispositions и evidence | |
| Low dispositions и evidence | |
| Targeted re-review после fixes | |
| Итоговый release verdict | |

Review exit достигнут только если все требуемые области проверены на одном commit/hash, `Blocker=0`, `High=0`, каждый `Medium`/`Low` исправлен, признан не применимым либо принят как явно доказанное ограничение, а после исправлений выполнено targeted re-review. Любое расхождение commit, VSIX SHA-256 или browser assets аннулирует зависимые результаты и требует повторного прогона соответствующей области.
