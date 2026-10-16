import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './database/prisma.module.js';
import { OpportunitiesModule } from './opportunities/opportunities.module.js';
import { QueueDashboardModule } from './queue/queue-dashboard.module.js';
import { QueueModule } from './queue/queue.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
    BullBoardModule.forRoot({ route: '/queues', adapter: ExpressAdapter }),
    QueueDashboardModule,
    OpportunitiesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
