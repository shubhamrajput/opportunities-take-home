import { NestFactory } from '@nestjs/core';
import { PlannerModule } from './planner.module.js';

const app = await NestFactory.createApplicationContext(PlannerModule);
app.enableShutdownHooks();
