import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';

@Module({
  imports: [BullModule.registerQueue({ name: BULK_MOVE_QUEUE })],
})
export class WorkersModule {}
