---
description: F5 «зависает при старте» — отладчик VS Code стучится в ::1, а хост расширений слушает 127.0.0.1; запускать Ctrl+F5
---

С обновления VS Code 25–27 сентября 2026 (папка сборки `04c0d99f4f`) отладочный хост расширений
стартует с `--inspect-brk=127.0.0.1:<порт>` и стоит на первой строке, пока к нему не подключится
отладчик. Встроенный `js-debug` в окне, где нажали F5, подключается к `::1:<тот же порт>` и
получает отказ — отладочное окно висит без хоста, а через 60 секунд пишет «The local extension
host took longer than 60s to send its ready message». Наш код тут ни при чём: до `activate` дело не
доходит.

Как узнать: в `%APPDATA%/Code/logs/<сессия>/window<N>/exthost/exthost.log` окна, где жали F5, — сотни
`RequestError: connect ECONNREFUSED ::1:<порт>` и `The onCancel handler was attached after the
promise settled`; в `renderer.log` отладочного окна — `Extension host did not start in 10 seconds
(debugBrk: true)`. Слушающий адрес видно `Get-NetTCPConnection -OwningProcess <pid> -State Listen`.

Обход — «Запуск без отладки» (Ctrl+F5): хост стартует без `--inspect-brk`. Точки останова тогда не
работают.
