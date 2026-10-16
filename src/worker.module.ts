import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './database/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
    WorkersModule,
  ],
})
export class WorkerModule {}
