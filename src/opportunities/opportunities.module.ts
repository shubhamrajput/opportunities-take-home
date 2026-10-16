import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BULK_MOVE_PLANNER_QUEUE } from '../queue/queue.constants.js';
import { BulkMoveService } from './bulk-move.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: BULK_MOVE_PLANNER_QUEUE })],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    BulkMoveService,
  ],
})
export class OpportunitiesModule {}
