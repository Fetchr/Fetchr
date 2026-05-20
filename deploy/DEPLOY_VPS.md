# Fetchr Landing VPS Deploy

Готовый архив сайта:

`deploy/fetchr-site.zip`

## 1. DNS

В панели домена создай A-запись:

`@ -> IP_ТВОЕГО_VPS`

Если нужен `www`:

`www -> IP_ТВОЕГО_VPS`

## 2. Загрузка на VPS

```bash
scp deploy/fetchr-site.zip root@IP_ТВОЕГО_VPS:/tmp/fetchr-site.zip
```

## 3. Установка на Ubuntu VPS

```bash
apt update
apt install -y nginx unzip certbot python3-certbot-nginx
mkdir -p /var/www/fetchr
unzip -o /tmp/fetchr-site.zip -d /var/www/fetchr
chown -R www-data:www-data /var/www/fetchr
```

## 4. Nginx

Скопируй `deploy/nginx-fetchr.conf` в:

`/etc/nginx/sites-available/fetchr`

Замени `example.com www.example.com` на свой домен.

```bash
ln -s /etc/nginx/sites-available/fetchr /etc/nginx/sites-enabled/fetchr
nginx -t
systemctl reload nginx
```

## 5. SSL

```bash
certbot --nginx -d example.com -d www.example.com
```

Если `www` не нужен, убери второй домен из команды.
