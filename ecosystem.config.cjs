module.exports = {
  apps: [
    {
      name: 'jobpilot-scheduler',
      script: './src/scheduler.js',
      cwd: __dirname,
      interpreter: 'node',
      windowsHide: true,
      detached: false,
      max_restarts: 10,
      restart_delay: 15000,
      autorestart: true,
      max_memory_restart: '800M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: 'NULL',
      error_file: 'NULL',
      env: {
        NODE_ENV: 'production',
        HEADLESS: 'true',
        FORCE_COLOR: '0'
      }
    }
  ]
};
