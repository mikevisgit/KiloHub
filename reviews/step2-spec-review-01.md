# Step 2 — первый цикл ревью ТЗ и результаты исправлений

## Scope

Объект ревью: нормативный пакет `req/step2/` до production-реализации. Текущий `src/` и VSIX `0.1.0` остаются Step 1 и не считаются evidence Step 2.

Проверены:

- согласованность канона, Уточнения ТЗ и размерного приложения;
- техническая реализуемость `WebviewView` в VS Code 1.105.1+;
- accessibility, keyboard, tooltip, themes и scroll/motion;
- миграция backend Step 1 к host/Webview presentation boundary;
- тестируемость, review exit и package/release gates.

## Первый feasibility-проход

| Finding | Severity | Решение | Evidence/status |
| --- | --- | --- | --- |
| Hover-only tooltip недоступен клавиатурой, не hoverable и может обрезать единственный полный путь | Blocker | Принят УТЗ-05: immediate hover/focus, popup hover, grace 120 ms, Escape latch, stable ARIA, viewport-fit/scroll | Канон, размерное приложение, `interaction.cjs`, offline verifier и manual checklist синхронизированы; fixed |
| Нельзя гарантировать 4,5:1 во всех сторонних темах | Medium | УТЗ-06: четыре точные built-in темы обязательны; custom themes best effort с semantic tokens/fallback | Канон, test matrix и manual checklist; fixed |
| Публичный Extension Host API не автоматизирует реальный DOM установленного Webview | Medium | УТЗ-07: component/host automation плюс обязательный пользовательский installed checklist | `03-test-matrix.md`, `04-manual-acceptance-checklist.md`; accepted platform limitation |
| «1000 sessions без заметной блокировки» не имеет числового SLA | Medium | УТЗ-08: числовой SLA отложен; проверяются результат, heartbeat и отсутствие параллельных reads | Канон и PERF-01; fixed as invariant |
| Нативный title `Kilo Folders` создаёт третью строку над двумя строками макета | Medium | УТЗ-04: native view называется `Kilo Hub`, DOM-header удалён, Webview начинается с `Мои папки с Kilo` | Канон/size/matrix; fixed |

## Повторное ревью согласованности

| Finding | Severity | Исправление | Status |
| --- | --- | --- | --- |
| Старый tooltip-контракт оставался в каноне, size spec, reference и verifier | Medium | Полная state machine перенесена в канон/size; reference и tests обновлены | Fixed |
| Неоднозначность initial delay: `600 ms` против немедленного показа | Medium | Нормативно закреплён немедленный показ; 120 ms только crossing grace | Fixed |
| Не определён keyboard contract пассивных conversation titles | Medium | Нет Tab-stop; видимый ellipsis `aria-hidden`, полный sr-only текст в accessibility tree | Fixed |
| Не определён current-folder resolver | Medium | Формализован single local folder resolver, exclusions, canonical match и update без DB read | Fixed |
| Не задан алгоритм инициалов монограммы | Medium | Формализован deterministic Unicode grapheme algorithm, 1–2 символа и `?` fallback | Fixed |
| Size spec описывал удалённый DOM-header | Medium | Нативный title исключён из Webview CSS; геометрия начинается с Intro | Fixed |
| Канон называл себя единственным источником вопреки приоритету Уточнения | Low | README/START_HERE/канон согласованы по приоритету | Fixed |

## Ревью тестируемости

| Finding | Severity | Исправление/status |
| --- | --- | --- |
| Production и VSIX Step 2 отсутствуют | Blocker для release, не дефект ТЗ | Явно отмечено во всех документах; production gates остаются pending до реализации `0.2.0` |
| Нет исполнимой traceability matrix и manual checklist | High | Созданы `req/step2/03-test-matrix.md` и `04-manual-acceptance-checklist.md`; fixed |
| Tooltip reference/test противоречит УТЗ-05 | High | Reference и verifier синхронизированы; fixed |
| Accessibility semantics недостаточно точны | High | Stable `aria-describedby`, owner state machine, passive-title semantics и NVDA checks определены; fixed |
| Step 1 package verifier не знает browser assets | High для будущего release | В каноне/матрице зафиксирован отдельный `0.2.0` package gate и обязательное обновление exact verifier; pending implementation, не ТЗ |
| Review exit неоперационален | Medium | Определены обязательные review domains, dispositions и targeted re-review на одном commit/hash; fixed |
| Theme scope невоспроизводим | Medium | Указаны четыре built-in theme IDs, версии/evidence и best-effort custom scope; fixed |
| Action checklist двусмысленен | Medium | Добавлена точная current/missing/action DOM/host matrix; fixed |
| Performance остаётся субъективным | Medium | Заменено на проверяемые invariants без numeric SLA; fixed |

## Архитектурный вывод

Блокеров миграции нет. Сохраняются adapter, read-only worker, domain projection, path safety и command executors Step 1. Меняется presentation boundary: `TreeDataProvider` заменяется host-контроллером `WebviewView`, presenter DTO и browser frontend. Webview не получает БД, `Uri` для исполнения или command IDs; сообщения проверяются runtime и разрешаются по snapshot/revision.

## Выполненные offline-проверки после исправлений

```text
build-final                 PASS
verify-final                PASS
verify-regressions          PASS
verify-scale                PASS
verify-colors               PASS
verify-button-tooltips      PASS
node --check reference JS   PASS
git diff --check            PASS
```

Эти проверки не являются browser/Webview/installed-VSIX evidence. Следующий обязательный шаг процесса ревью — независимый повторный проход уже по синхронизированному пакету и фиксация оставшихся findings либо чистого результата.
