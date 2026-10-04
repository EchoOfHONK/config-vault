# Выполненные проверки

Дата: 2–3 октября 2026. Проверки выполнены при разработке этой поставки; для вашего сервера повторите их после установки.

## Проверка Docker deployment и полного восстановления

Команда: `scripts/verify-debian.sh`. Результат: **успешно**, exit code `0`. Машиночитаемый отчёт: [verification/recovery-report.json](verification/recovery-report.json).

Повторный полный запуск 3 октября прошёл на окончательных исходниках, включая уведомление о конфликте и просмотр hooks с доступом по отдельной конфигурации. SHA-256 всех 42 файлов исходников и сборки остались неизменными во время проверки: [verification/source-manifest.json](verification/source-manifest.json). Восстановление с новым ключом повторно подтвердило 2 устройства, 5 конфигураций, 13 версий, 1 снимок, 2 пользователя, Activity и пригодность восстановленных SSH credentials.

Запуск использовал отдельный Compose project с новыми каталогами, новыми случайными credentials и loopback HTTP портом. Production frontend собран TypeScript/Vite в Node.js 22/pnpm 11.19.0; приложение отдавал nginx. Backend работал в Python 3.12/Debian контейнере, PostgreSQL — настоящий `postgres:16-alpine`. Отдельный SSH target использовал настоящий Debian 13, OpenSSH и nginx. Docker daemon запускался через существующую Colima VM на macOS; это проверка реальных Linux контейнеров, **не** установка на отдельный bare-metal Debian хост.

Проверено:

- Пустое хранилище без демонстрационных данных, bootstrap администратора и вход через nginx с Origin, содержащим HTTP порт.
- Локальный импорт настоящих файлов nginx, Docker Compose, WireGuard и systemd через read-only mount.
- Создание версии 2, реальный построчный diff, restore версии 1 как новой версии 3 с сохранённой историей.
- Создание снимка, изменение файла и восстановление выбранного файла из снимка.
- Настоящий SSH connect с подтверждённым host key, import, внешнее изменение, sync и conflict.
- Явное Keep Remote и Safe Apply JSON кандидата на настоящий remote файл.
- Ограничение Viewer по устройству, запрет изменения и маскирование private key.
- Зашифрованный portable backup через REST API и скачивание его файла.
- Фактический процесс Uvicorn имел uid/gid `10001`; read-only rootfs и защищённые mounted secrets не мешали работе.
- Offline backup CLI и экспорт его файла через `docker compose cp` из остановленного контейнера.
- Полное удаление PostgreSQL и vault каталогов **только изолированного тестового экземпляра**.
- Генерация нового ключа шифрования и offline восстановление portable backup на полностью пустой базе.
- После восстановления сохранились 2 устройства, 5 конфигураций, 13 версий, 1 снимок, 2 пользователя и Activity. Восстановленные SSH credentials оставались пригодны для подключения.

После сценария все контейнеры его Compose project удалены. Тест не обращался к рабочим конфигурациям пользователя и не удалял production данные.

## Проверка скриптов и установщика

`shellcheck` успешно проверил `install.sh`, `update.sh`, `backup.sh`, `restore.sh`, `scripts/common.sh`, `scripts/ssh-fixture.sh`, `scripts/verify-debian.sh` и SSH fixture entrypoint. Python источники скриптов прошли компиляцию.

Контролируемый запуск компонента установщика подтвердил права `0600` у файлов секретов, постоянный Fernet key правильного размера, отсутствие пароля администратора в `.env` и отказ от пути с shell substitution. Скрипт не исполняет содержимое `.env` через `source`/`eval`.

## Финальный аудит 3 октября 2026

`pnpm audit --prod --json` через публичный npm registry проверил 34 production dependencies: известных vulnerabilities не обнаружено. `pip-audit` проверил зависимости production Python image: application libraries прошли проверку; advisories старого встроенного pip устранены закреплением `pip==26.2.0` в Dockerfile. Повторная проверка в отдельном контейнере с этим pip завершилась `No known vulnerabilities found`. Результат относится к состоянию registry на дату проверки.

Scripts имеют права `0755`; defaults сохраняют loopback binding и не содержат паролей. Секретных ключей, реального `.env`, application database и backup файлов в каталоге исходников не обнаружено. CI использует актуальные `CONFIG_VAULT_TEST_DATABASE_URL` и `SSH_TEST_*`; одноразовый SSH fixture остаётся отдельным тестовым сервисом.

Backup script готовит EXIT recovery до остановки сервисов и возобновляет только ранее работавшие backend/frontend без запуска dependencies. Контролируемые проверки ошибок подтвердили сохранение исходного exit status, восстановление после частичной остановки, отказ создания backup, ошибку возобновления и сохранение выключенных сервисов выключенными. `shellcheck` после изменения успешно прошёл.

## Backend и браузерная проверка 3 октября 2026

Итоговый набор backend tests: **34 passed, 0 failed, 0 skipped** на настоящем PostgreSQL 16 с Debian 13/OpenSSH fixture. Включены конфликты, restore, snapshots, полное восстановление encrypted backup под новым master key, RBAC, encrypted credentials, SSH password/Ed25519 auth, validation, hooks и masking. Дополнительная проверка закрывает создание удалённого источника через права только на Project/Service: разрешённый multipart import работает, неподтверждённый источник недоступен, автоматический watcher его не регистрирует, config-scoped Apply остаётся доступен для уже одобренного файла. Общие секретные шаблоны раскрываются только Admin.

TypeScript check и Vite production build успешны. В браузере созданы настоящее устройство и nginx.conf: редактирование создало Version 2, оба режима diff показали изменения, Restore создал Version 3 и сохранил Version 2. Создан snapshot, файл изменён до Version 4, snapshot restore создал Version 5 с исходным содержимым. Настоящий SSH conflict разрешён через Keep Vault; проверка реального файла подтвердила запись выбранного значения, внешнее предыдущее содержимое осталось в истории как отдельная версия.

Проверены desktop layout и узкий responsive layout: фактическая CSS ширина страницы 325px не превышала viewport; история и Restore preview отображались. Полный workflow на физическом телефоне не выполнялся. Машиночитаемые результаты: [test-report.json](verification/test-report.json). Снимки интерфейса: [diff](verification/desktop-diff.jpg), [история Restore](verification/restored-history.jpg), [snapshot restore](verification/snapshot-restore.jpg), [SSH conflict](verification/ssh-conflict.jpg), [сохранённая remote история](verification/ssh-preserved-history.jpg), [узкий Restore preview](verification/mobile-restore.jpg).

## Что этот запуск не проверял

Сценарий не устанавливал Docker Engine или TLS сертификат на новом физическом Debian сервере и не проверял публичный HTTPS домен. SSH fixture не запускает systemd как PID 1, поэтому успешный `systemctl reload` в нём не заявляется. Реальная ошибка hook и её audit проверяются отдельными backend integration tests. Для production проверьте права SSH пользователя, `nginx -t`, Compose validator, реальный reload и HTTPS на вашем target.
