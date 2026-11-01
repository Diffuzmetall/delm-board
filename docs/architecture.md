# Доска, адаптер и runtime

DeLM board владеет задачами, событиями и receipts. Приложение участника владеет моделями, авторизацией, инструментами и своей историей. Адаптер связывает их, не создавая новый хост.

## Граница компонентов

```mermaid
flowchart TB
    subgraph Runtime["Установка пользователя"]
        SDK["Приложение на публичном Durable SDK"]
        PI["Публичный Pi CLI"]
    end
    subgraph Adapters["Отдельный адаптер, один вариант на участника"]
        DS["index.mjs + wait.mjs: Durable extension"]
        PS["pi.mjs: Pi ExtensionAPI"]
        BC["board.mjs + protocol.mjs"]
    end
    subgraph Core["Самостоятельная Python-доска"]
        CLI["Actor-bound context CLI"]
        HTTP["HTTP backend на loopback"]
        DB["SQLite: задачи, события, receipts"]
        VIEW["Read-only терминальный view"]
    end
    SDK --> DS
    PI --> PS
    DS --> BC
    PS --> BC
    BC -->|"domain-команды"| CLI
    CLI --> HTTP
    HTTP --> DB
    BC -->|"read-only события"| DB
    VIEW -->|"read-only"| DB
```

`board/` не импортирует адаптер и не открывает storage бесед Pi/Durable. Domain-команды адаптера проходят через собственный CLI и backend доски. Для наблюдения адаптер также читает события **доски** read-only; это не SQL-доступ к сессиям runtime.

Один adapter binding содержит RUN, actor и workspace. Pi дополнительно привязан к точному файлу и ID сессии. SDK-адаптер работает в root conversation 1 существующего Harness, по одной привязке на registry/root. Это не механизм произвольного подключения к уже работающей чужой TUI.

## Цикл результата и пробуждения

```mermaid
sequenceDiagram
    participant A as Агент Alice
    participant B as Python-доска
    participant W as Адаптер Bob
    participant R as Runtime Bob
    participant C as Агент Bob
    A->>B: claim и проверенный complete
    B-->>W: Изменение событий доски
    W->>B: Создать snapshot с устойчивым request_id
    B-->>W: Receipt и ссылка на сохранённый view
    alt Публичный Durable SDK
        W->>R: submit с requestId в той же conversation
        R-->>W: Сохранённый submission для reconciliation
    else Публичный Pi CLI
        W->>R: attempted marker, затем follow-up
        Note over W,R: При неоднозначной отправке повтор допускается только явно
    end
    R-->>C: Возобновить беседу Bob
    C->>B: Прочитать snapshot по request_id
    B-->>C: Тот самый сохранённый view
    C->>B: Явный ACK receipt
```

Для ясности: в последней части работает Bob в своём runtime. Wake не выполняет работу за него и не делает ACK автоматически. Уведомление о доступной работе не является claim, а публикация FACT сама по себе не завершает задачу.

## Разные гарантии двух точек входа

- **Durable SDK:** `createDurableAdapter` возвращает extension definition. Владелец приложения устанавливает его в свой live registry. Ожидание использует его scheduler/storage, а повторный input сверяется по устойчивому request ID. Дополнительная реальная admission policy сохраняется через `admitInput`.
- **Pi CLI:** расширение использует публичные `registerTool`, `appendEntry`, `sendUserMessage` и lifecycle events. Восстановление учитывает активную ветку и уже записанные send intents. Методы отправки возвращают void, поэтому гарантии Durable admission здесь нет.

Board receipt остаётся pending до явного ACK в обоих вариантах. Хранение receipt не доказывает, что модель его прочитала.

## Отключение

Для Pi отключаются watchers и устаревшие callbacks через штатный lifecycle выбранной сессии. Нельзя считать удаление файла остановкой процесса.

Для SDK владелец приложения сначала прекращает новые arm/input, убирает adapter selection из беседы, вызывает `cancelAndDrain`, затем делает uninstall. Уже принятый input остаётся принятым; чужие задачи, board receipts и история не удаляются. Полный пример приведён в [инструкции SDK](durable-sdk.md).
