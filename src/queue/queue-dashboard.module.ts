import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BULK_MOVE_QUEUE } from './queue.constants.js';
import { QueueModule } from './queue.module.js';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: BULK_MOVE_QUEUE }),
    BullBoardModule.forFeature({
      name: BULK_MOVE_QUEUE,
      adapter: BullMQAdapter,
      options: { readOnlyMode: true },
    }),
  ],
})
export class QueueDashboardModule {}
