import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './database/prisma.module.js';
import { BulkMoveScheduler } from './opportunities/bulk-move-scheduler.js';
import { BULK_MOVE_QUEUE } from './queue/queue.constants.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    BullModule.registerQueue({ name: BULK_MOVE_QUEUE }),
  ],
  providers: [BulkMoveScheduler],
})
export class SchedulerModule {}
