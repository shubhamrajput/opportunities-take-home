import { Module } from '@nestjs/common';
import { BulkMoveService } from './bulk-move.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';

@Module({
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    BulkMoveService,
  ],
})
export class OpportunitiesModule {}
