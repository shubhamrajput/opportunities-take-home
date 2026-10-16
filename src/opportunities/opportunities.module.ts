import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';
import { BulkMoveScheduler } from './bulk-move-scheduler.js';
import { BulkMoveService } from './bulk-move.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: BULK_MOVE_QUEUE })],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    BulkMoveService,
    BulkMoveScheduler,
  ],
})
export class OpportunitiesModule {}
