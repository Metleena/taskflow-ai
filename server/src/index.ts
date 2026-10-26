import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import { config, assertConfig } from './config.ts';
import { createApp } from './app.ts';
import { startWorker } from './notifications.ts';
import { log } from './util.ts';

assertConfig();
await fs.mkdir(config.uploadDir, { recursive: true });
await mongoose.connect(config.mongoUri);
await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes (incl. the unique idempotency key)
startWorker();
createApp().listen(config.port, () => log.info(`TaskFlow API listening on http://localhost:${config.port}`));
