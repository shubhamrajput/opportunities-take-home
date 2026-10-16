import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module.js';
import { PlannersModule } from './planners/planners.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
    PlannersModule,
  ],
})
export class PlannerModule {}
