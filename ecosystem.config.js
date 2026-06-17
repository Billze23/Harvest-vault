module.exports = {
  apps: [{
    name:         'harvest-vault',
    script:       'server.js',
    cwd:          __dirname,
    instances:    1,          // SQLite works best with 1 process
    autorestart:  true,
    watch:        false,
    max_memory_restart: '256M',
    env_production: {
      NODE_ENV: 'production',
      PORT:     3000
    },
    // Log files — adjust paths to suit your server
    out_file:  './logs/out.log',
    error_file:'./logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
