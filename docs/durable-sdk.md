# Подключить публичный Pi Durable SDK

Эта инструкция для приложения на `@earendil-works/pi-durable@1.4.0`. Если вы запускаете обычный `pi`, используйте раздел Pi CLI в [README](../README.md). Публичный Durable — библиотека без CLI; установленный рядом пакет сам по себе не превращает Pi в Durable.

## Что нужно от вашего приложения

- Доступ к существующим `registry`, `harness`, root conversation и Chord context.
- Один RUN и один actor на этот root/registry. Actor должен существовать в RUN.
- Эффективная рабочая папка conversation/environment совпадает с проектом доски.
- Запущен backend доски. Его domain-команды вызываются через actor-bound CLI.

Адаптер не выбирает модель, не читает авторизацию автора, не открывает второй Harness/storage и не меняет ваш execution environment. Если приложение не предоставляет точки расширения, одной команды установки SDK недостаточно: сначала найдите реальный loader/API этого приложения.

## Получить адаптер

Вы можете клонировать репозиторий и установить его локальные зависимости по README. Для подключения из отдельного Node-проекта добавьте пакет из GitHub, а не из несуществующего npm-релиза:

```sh
npm install --ignore-scripts 'git+https://github.com/Diffuzmetall/delm-board.git'
```

Команда меняет зависимости только выбранного проекта. Сохраняйте согласованное дерево публичных SDK 1.4.0; не смешивайте случайные версии или private source aliases. Для воспроизводимой поставки можно закрепить Git commit в зависимости. Этот проект не выполняет npm publish.

## Установить в существующий registry

Встройте этот фрагмент в точку расширения вашего приложения. `registry`, `harness`, `root` и `context` ниже уже принадлежат ему:

```js
import { createDurableAdapter, cancelAndDrain } from 'delm-board/durable';

const options = { run: '/absolute/private/run', actor: 'bob' };
const adapter = createDurableAdapter(options);
registry.install(adapter);

// Нужно, если приложение использует явный список extensions/tools.
await root.configure({ extensions: { add: [adapter] } }, context);
```

Из корня самого клона допустим относительный import `./adapters/durable/index.mjs`. Factory возвращает definition; не создаёт новый registry и не копирует его. Устанавливайте definition именно в registry, который использует ваш Harness, в том числе при hot attachment.

Адаптер предоставляет:
- `delm_board`: domain JSON-команды доски без shell tool и без настройки PATH;
- `delm_wait`: ожидание конкретных зависимостей или доступной работы через scheduler Durable.

В prompt также передаётся абсолютный actor-bound CLI. Ни токены, ни содержимое `config.json` не становятся аргументами инструмента модели. Проверки workspace выполняются перед инструментом и отправкой wake, а не только по `process.cwd()`.

Если приложение имеет дополнительную admission policy, передайте реальный callback:

```js
const adapter = createDurableAdapter({
  run: '/absolute/private/run',
  actor: 'bob',
  admitInput: async (conversation, requestId, context, runtime) => {
    await existingApplicationPolicy(conversation, requestId, context, runtime);
  },
});
```

`existingApplicationPolicy` — ваша действительная функция, не готовая функция этого пакета. Не заменяйте обязательную policy заглушкой. Без дополнительного callback используется штатный Durable submit; hooks и guards самого приложения остаются в силе.

## Сохранить инструменты приложения

Пустой `createRegistry()` не устанавливает автоматически coding tools или execution environment. Для обычной работы с файлами приложение должно уже предоставлять свои инструменты либо выбрать публичный `CodingTools`. Адаптер доски этого не меняет.

Публичные компоненты для владельца, который настраивает их впервые:

```js
import { CodingTools } from '@earendil-works/pi-durable/tools';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

registry.install(CodingTools);
await root.configure({ extensions: { add: [CodingTools] } }, context);

// Пример только для собственной конфигурации HarnessOptions.env приложения.
const env = target => new NodeExecutionEnv({
  cwd: target.cwd ?? '/absolute/project',
  shellEnv: { ...process.env },
});
```

Не подменяйте уже настроенную sandbox/environment этим примером. Для прямого `delm_board` shell и actor PATH не нужны. Если используете bare `context` через Bash, задайте actor PATH в собственной environment или вызывайте абсолютный CLI, указанный адаптером.

## Проверить результат

Сначала в отдельной disposable фикстуре подтвердите наличие двух tools, фактический workspace и actor-bound операцию доски. Затем проверьте snapshot/read/ACK и отказ неверной привязки. Если модельный smoke согласован, подтвердите реальную цепочку: producer complete, событие, wake нужной conversation, чтение сохранённого receipt и явный ACK.

Для самого репозитория доступны:

```sh
npm run test:sdk
python3 tests/package.py
```

Это настоящие публичные Harness, SQLite storage, registry и scheduler с детерминированной моделью. Наличие SDK или зелёный import сам по себе не доказывает, что ваше конкретное приложение загрузило адаптер.

## Отключить адаптер

Прекратите новые tool/input-вызовы штатным lifecycle приложения. Уберите adapter selection из беседы, отмените и дождитесь только его wait-задач, затем удалите definition:

```js
await root.configure({ extensions: { remove: [adapter] } }, context);
const outcomes = await cancelAndDrain(harness, options, context);
registry.uninstall(adapter);
```

`cancelAndDrain` сохраняет чужие задачи, историю и непрочитанные board receipts. Поле `alreadyAdmitted` отдельно сообщает о принятом input: удаление extension не отзывает его и не стирает историю. Сам по себе abort беседы или uninstall не останавливает background wait надёжно. Во время drain владелец приложения не должен допускать новые arm-вызовы.

При открытии сохранённых активных waits сначала снова установите definition и лишь затем продолжайте scheduler. Восстановление относится к тому же хранилищу и root conversation 1; произвольная новая сессия не является заменой прежней.
