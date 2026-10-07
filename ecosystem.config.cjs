module.exports = {
  apps: [
    {
      name: 'jobpilot-scheduler',
      script: './src/scheduler.js',
      cwd: __dirname,
      interpreter: 'node',
      node_args: '--max-old-space-size=512 --expose-gc',
      windowsHide: true,
      detached: false,
      max_restarts: 20,
      restart_delay: 5000,
      autorestart: true,
      max_memory_restart: '650M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: {
        NODE_ENV: 'production',
        HEADLESS: 'true',
        FORCE_COLOR: '0'
      }
    }
  ]
};
