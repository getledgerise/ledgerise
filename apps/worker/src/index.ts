const schedule = process.env.ENGINE_SCHEDULE_CRON ?? '0 * * * *';

console.log(`Ledgerise worker scaffold ready. Engine schedule: ${schedule}.`);
