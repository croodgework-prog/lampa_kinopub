# kp-api-relay — резервный канал к API kinopub через Cloudflare Worker

Зачем: российские провайдеры блокируют хосты API kinopub (`api.service-kp.com`, `api.srvkp.com`,
`kpapp.link`) по DNS/SNI/IP, а домены `*.workers.dev` (Cloudflare) остаются доступны. kp.js
с v1.0.80 использует relay **только как запасной путь**: сначала идёт напрямую, при таймауте
переключается на relay и держится на нём до перезапуска Lampa.

Видео и субтитры через relay не идут: мастер-плейлист уже ходит через manifest-proxy,
сегменты и `.srt` берутся напрямую с CDN kinopub (`msk-static-NN.cdntogo.net`).

## Развернуть (5 минут, бесплатно)

1. Зарегистрироваться на https://dash.cloudflare.com (нужна только почта).
2. Слева **Workers & Pages** → **Create** → **Create Worker** → имя, например `kp-relay` → **Deploy**.
3. Нажать **Edit code**, удалить всё в редакторе, вставить содержимое файла `worker.js` → **Deploy**.
4. Вернуться к воркеру → **Settings** → **Variables and Secrets** → **Add**: имя `SECRET`,
   значение — любая длинная строка без пробелов (например `x7Hq2pLm9vRt4sWe`) → **Deploy**.
5. Проверить в браузере: `https://kp-relay.<ваш-аккаунт>.workers.dev/<SECRET>/health`
   → должно вернуться `{"ok":true,"service":"kp-api-relay",...}`.

## Подключить в Lampa

Настройки → KinoPub → **Резервный relay API** → ввести адрес **вместе с секретом**, без слеша в конце:

```
https://kp-relay.<ваш-аккаунт>.workers.dev/<SECRET>
```

Полностью перезапустить Lampa. В «Показать отчёт диагностики» строка `api=` покажет, какой канал
используется; при блокировке провайдером в логе появится `api host unreachable, switching to relay`.

## Безопасность

- Без `SECRET` воркер открыт всем, кто узнает адрес, — задайте его обязательно.
- Воркер пропускает запросы только к хостам API kinopub, ничего другого через него не проксируется.
- Через relay проходит ваш токен kinopub (как и напрямую к API). Cloudflare видит трафик воркера.
