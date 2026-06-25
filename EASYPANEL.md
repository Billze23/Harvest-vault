# Deploying Harvest Vault on EasyPanel

This guide assumes EasyPanel is already installed and running on your VPS. If not, install it first:
```bash
curl -sSL https://get.easypanel.io | sh
```
Then visit `http://your-server-ip:3000` to finish EasyPanel's own setup.

---

## 1. Push the Code to GitHub

EasyPanel deploys from a Git repository, so the code needs to live on GitHub first.

```bash
cd harvest-vault
git init
git add .
git commit -m "Initial commit — Harvest Vault v1.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/harvest-vault.git
git push -u origin main
```

> The included `Dockerfile` and `.dockerignore` are already in the project — EasyPanel will detect and use the Dockerfile automatically instead of guessing your build with Nixpacks. This matters here because `better-sqlite3` needs native compilation tools that Nixpacks may not include by default.

---

## 2. Create a New Project in EasyPanel

1. Log into your EasyPanel dashboard
2. Click **+ Create Project**
3. Name it `harvest-vault`
4. Click **Create**

---

## 3. Add the App Service

1. Inside the project, click **+ Service**
2. Choose **App**
3. Under **Source**, select **GitHub**
   - Connect your GitHub account if you haven't already (EasyPanel will ask for repo access)
   - Select the `harvest-vault` repository
   - Branch: `main`
4. Under **Build**, EasyPanel should auto-detect the `Dockerfile` in your repo root. Confirm **Build Method = Dockerfile**.
5. Click **Save**

---

## 4. Set Environment Variables

Go to the **Environment** tab on your service and add:

```
NODE_ENV=production
PORT=3000
SESSION_SECRET=paste-a-long-random-string-here
```

Generate a secret locally first:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Click **Save**.

---

## 5. Add Persistent Storage (Critical Step)

Your SQLite database lives in `/app/data` inside the container. Without a mounted volume, **all data is lost on every redeploy**.

1. Go to the **Mounts** (or **Volumes**) tab on your service
2. Click **+ Add Mount**
3. Set:
   - **Type:** Volume
   - **Mount Path:** `/app/data`
   - **Volume Name:** `harvest-vault-data` (or any name you prefer)
4. Save

This ensures `harvest-vault.db` and `sessions.db` persist across deployments and restarts.

---

## 6. Deploy

1. Go to the **Deployments** tab
2. Click **Deploy**
3. Watch the build logs — first build will take a minute or two (installing Node + compiling `better-sqlite3`)
4. Once it shows **Running**, the app is live on its internal port 3000

---

## 7. Set Up Your Domain

1. Go to the **Domains** tab on your service
2. Click **+ Add Domain**
3. Enter your domain (e.g. `vault.yourcompany.com`) — make sure its DNS A record already points to your server's IP
4. Toggle **HTTPS** on — EasyPanel provisions a free Let's Encrypt certificate automatically
5. Save

If you don't have a domain yet, EasyPanel also gives you a temporary auto-generated subdomain you can use to test immediately.

---

## 8. Create Your Admin Account

You need to run the setup script once, inside the running container.

1. Go to your service's **Console** tab (a terminal opens directly in the browser, connected to the container)
2. Run:
   ```bash
   npm run setup-admin
   ```
3. Follow the prompts to create your admin and sales accounts

---

## 9. Enable Auto-Deploy on Push (Optional but Recommended)

1. Go to the **Source** tab on your service
2. Toggle **Auto Deploy** on
3. EasyPanel adds a webhook to your GitHub repo — every `git push` to `main` now triggers an automatic redeploy

Your future update workflow becomes just:
```bash
git add .
git commit -m "describe your change"
git push
```

---

## 10. Verify

Visit your domain. You should see the Harvest Vault login screen. Log in with the admin account you just created and confirm you can create a client and a booking.

---

## Backups

Since the database is a single file inside your mounted volume, back it up periodically. From the EasyPanel server itself (not inside the container):

```bash
# Find your volume's location on disk (EasyPanel manages this under /etc/easypanel/projects/)
sudo find /etc/easypanel -name "harvest-vault.db"
```

Once you have the path, set up a cron job to copy it nightly, same as in the standard VPS guide (`DEPLOY.md`).

---

## Troubleshooting

**Build fails on better-sqlite3:**
Confirm EasyPanel is using the Dockerfile (not Nixpacks) — check the **Build** tab on your service.

**App shows "Internal Server Error" after deploy:**
Check the **Logs** tab. Most likely missing `SESSION_SECRET` in environment variables.

**Data disappeared after a redeploy:**
The volume mount (Step 5) wasn't configured before the first deploy, or the mount path doesn't match `/app/data` exactly.

**Can't reach the admin console:**
Use the **Console** tab in the EasyPanel UI, not SSH — it connects directly into the running container where `npm run setup-admin` needs to execute.
