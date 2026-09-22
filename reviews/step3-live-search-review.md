# Ревью auto-search0.3.2

Добавлен debounce300ms, Enter/сброс без ожидания, normalized-query dedupe, IME/dispose cleanup и удержание одного последнего snapshot во время нового ввода. Backend cancellation/revision guards не менялись.

Первый независимый проход нашёл P2: ранее начатый chunked render мог продолжить показ старой выдачи во время debounce. Исправлен yieldRender: ожидание завершения debounce/IME с повторной проверкой условий, пробуждение на отмене таймера и generation fence перед отрисовкой. Повторное review: actionable findings нет, P2 закрыт. Дополнительный тест покрывает dispose припаркованной отрисовки.

Component39/39, TypeScript-компиляция tests и ESLint PASS. Детерминированные часы проверяют299/300ms, перенабор, немедленный Enter без дубля, reset/short/IME/dispose, поздние ответы и chunk resume/cancel. Release/installed проверки выполняются отдельно; текущий пользовательский VSIX пока0.3.1.
