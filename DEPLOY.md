# Harvest Vault — Generic VPS Deployment (Manual / PM2 + Nginx)

If you're not using EasyPanel, see EASYPANEL.md instead for that flow.
This file covers a manual setup: Node + PM2 + Nginx + Let's Encrypt.

## 1. Server Prep
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3 nginx
sudo npm install -g pm2
```

## 2. Upload & Install
```bash
scp -r harvest-vault/ user@yourserver:/var/www/harvest-vault
cd /var/www/harvest-vault
npm install --production
```

## 3. Configure
```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
nano .env   # paste the secret in, set NODE_ENV=production
```

## 4. Create Admin Account
```bash
npm run setup-admin
```

## 5. Start with PM2
```bash
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # run the command it outputs
```

## 6. Nginx Reverse Proxy
```bash
sudo nano /etc/nginx/sites-available/harvest-vault
```
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/harvest-vault /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

## 7. SSL
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## 8. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Backups
```bash
crontab -e
# add:
0 2 * * * cp /var/www/harvest-vault/data/harvest-vault.db /var/backups/harvest-vault-$(date +\%Y\%m\%d).db
```

## Updating
```bash
cd /var/www/harvest-vault
git pull
npm install --production
pm2 restart harvest-vault
```
