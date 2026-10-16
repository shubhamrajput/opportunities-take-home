import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  BULK_MOVE_PLANNER_QUEUE,
  BULK_MOVE_QUEUE,
} from '../queue/queue.constants.js';
import { BulkMovePlannerProcessor } from './bulk-move-planner.processor.js';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: BULK_MOVE_PLANNER_QUEUE },
      { name: BULK_MOVE_QUEUE },
    ),
  ],
  providers: [BulkMovePlannerProcessor],
})
export class PlannersModule {}
