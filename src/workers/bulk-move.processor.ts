import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BULK_MOVE_QUEUE } from '../queue/queue.constants.js';

@Processor(BULK_MOVE_QUEUE)
export class BulkMoveProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    throw new Error(
      `Bulk move processing is not implemented yet (job ${job.id ?? 'unknown'})`,
    );
  }
}
