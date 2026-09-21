# Проверка изоляции тестового runtime

Первый независимый проход выявил High (PATH/Path при повторном merge test-electron), Medium (spawnSync не доказывает отсутствие .cmd/.bat shims) и Low (cleanup после ошибки prepare/restore).

Исправления: `scripts/restricted-test-env.mjs` нормализует parent environment на время runTests и восстанавливает его; оба runner используют helper. Абсолютный System32/where.exe проверяет команды и exe/cmd/bat без их запуска. Profile preparation перенесена внутрь cleanup boundary, удаление temp root выполняется nested finally.

Повторное независимое review подтвердило закрытие всех трёх findings. Дополнительный Low об order-dependent --without-node исправлен единым includes-based boolean; исходный порядок аргументов не затрагивался.

Current Extension Host --without-node --uppercase-path: четыре profile/root запуска PASS после основных исправлений, встроенный FTS5 работает. Это controlled command search environment, не физическое удаление Node с машины. Installed artifact ещё не проверен. Синтетический KILO_DB задаётся до запуска, Production-mode source resolution проверяется дополнительно в Gate B/D.
