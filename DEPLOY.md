# Harvest Vault — VPS Deployment Guide

## Requirements
- Ubuntu 22.04 LTS (or 20.04)
- Node.js 18+ 
- Nginx
- A domain name pointed at your server (or use IP directly)

---

## 1. Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v   # should show v20.x.x
npm -v

# Install PM2 globally (process manager — keeps app running)
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx

# Install build tools (needed for better-sqlite3)
sudo apt install -y build-essential python3
```

---

## 2. Upload the Application

From your local machine, copy the project to your server:

```bash
# Option A — SCP (replace user@yourserver with your details)
scp -r harvest-vault/ user@yourserver:/var/www/harvest-vault

# Option B — Git (recommended for updates)
# On your server:
sudo mkdir -p /var/www/harvest-vault
sudo chown $USER:$USER /var/www/harvest-vault
cd /var/www/harvest-vault
git init
# Then push from your local machine or clone from your repo
```

---

## 3. Install Dependencies

```bash
cd /var/www/harvest-vault
npm install --production
```

---

## 4. Configure Environment

```bash
# Copy the example config
cp .env.example .env

# Generate a secure session secret
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Edit .env with your values
nano .env
```

Your `.env` should look like:
```
NODE_ENV=production
PORT=3000
SESSION_SECRET=paste-your-generated-secret-here
```

---

## 5. Create the Admin Account

```bash
cd /var/www/harvest-vault
npm run setup-admin
```

Follow the prompts to create:
- An **admin** account (full access, can delete bookings, change pricing)
- A **sales** account (can create clients and bookings, view invoices)

You can run this script again at any time to reset a password.

---

## 6. Start the Application with PM2

```bash
cd /var/www/harvest-vault

# Create logs directory
mkdir -p logs

# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 config so it restarts after server reboots
pm2 save

# Set PM2 to run on startup
pm2 startup
# Copy and run the command it outputs (it will look like: sudo env PATH=... pm2 startup ...)
```

Useful PM2 commands:
```bash
pm2 status              # check if app is running
pm2 logs harvest-vault  # view live logs
pm2 restart harvest-vault
pm2 stop harvest-vault
```

---

## 7. Configure Nginx as a Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/harvest-vault
```

Paste this config (replace `yourdomain.com` with your actual domain or server IP):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Proxy all requests to Node
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the config:
```bash
sudo ln -s /etc/nginx/sites-available/harvest-vault /etc/nginx/sites-enabled/
sudo nginx -t          # test for syntax errors
sudo systemctl restart nginx
```

---

## 8. Add SSL with Let's Encrypt (Strongly Recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will automatically update your Nginx config and set up auto-renewal.

After SSL is set up, update `.env`:
```
NODE_ENV=production   # this enables secure cookies
```
Then restart: `pm2 restart harvest-vault`

---

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 10. Verify Everything Works

1. Visit `https://yourdomain.com` in your browser
2. You should see the Harvest Vault login screen
3. Log in with the admin credentials you created in step 5
4. Create a test client and booking to confirm data persists

---

## File Locations Reference

| What | Where |
|------|-------|
| Application code | `/var/www/harvest-vault/` |
| SQLite database | `/var/www/harvest-vault/data/harvest-vault.db` |
| Session store | `/var/www/harvest-vault/data/sessions.db` |
| App logs | `/var/www/harvest-vault/logs/` |
| Nginx config | `/etc/nginx/sites-available/harvest-vault` |
| Environment config | `/var/www/harvest-vault/.env` |

---

## Backups

The entire database is a single file. Back it up with a cron job:

```bash
crontab -e
```

Add this line (backs up nightly at 2am, keeps 30 days):
```
0 2 * * * cp /var/www/harvest-vault/data/harvest-vault.db /var/backups/harvest-vault-$(date +\%Y\%m\%d).db && find /var/backups/ -name "harvest-vault-*.db" -mtime +30 -delete
```

---

## Updating the App

When you have changes to deploy:

```bash
cd /var/www/harvest-vault

# Pull latest code (if using git)
git pull

# Install any new dependencies
npm install --production

# Restart
pm2 restart harvest-vault
```

---

## Troubleshooting

**App won't start:**
```bash
pm2 logs harvest-vault --lines 50
```

**Nginx 502 Bad Gateway:**
- Check the app is running: `pm2 status`
- Check it's on port 3000: `curl http://localhost:3000/api/auth/me`

**Permission errors on database:**
```bash
sudo chown -R $USER:$USER /var/www/harvest-vault/data
```

**Reset admin password:**
```bash
cd /var/www/harvest-vault
npm run setup-admin
```
