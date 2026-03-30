module.exports = {
  apps: [{
    name: 'tmcai-server',
    script: './dist/server.js',
    cwd: '/var/www/tmcai/server',
    instances: 1,
    exec_mode: 'fork',         // NOT cluster — cron jobs + vector store must be singletons
    node_args: '--max-old-space-size=1024',
    max_memory_restart: '1G',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/tmcai/error.log',
    out_file: '/var/log/tmcai/out.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
