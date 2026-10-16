import { NestFactory } from '@nestjs/core';
import { SchedulerModule } from './scheduler.module.js';

const app = await NestFactory.createApplicationContext(SchedulerModule);
app.enableShutdownHooks();
