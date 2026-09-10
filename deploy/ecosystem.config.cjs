// pm2:  pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: 'datec-salda',
    script: 'server.mjs',
    cwd: __dirname + '/..',
    env: { NODE_ENV: 'production', TZ: 'Europe/Prague' },
    max_memory_restart: '200M',
    time: true,
  }],
};
