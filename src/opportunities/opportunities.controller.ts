import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateBulkMoveDto,
  CreateOpportunityDto,
  MoveOpportunityStageDto,
  OpportunityPaginationQuery,
} from './dto.js';
import { BulkMoveService } from './bulk-move.service.js';
import { IdempotencyKey } from './idempotency-key.decorator.js';
import { OpportunitiesService } from './opportunities.service.js';
import { WorkspaceId, WorkspaceIdPipe } from './workspace-id.decorator.js';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
    private readonly bulkMoveService: BulkMoveService,
  ) {}

  @Post('bulk-move')
  @HttpCode(HttpStatus.ACCEPTED)
  submitBulkMove(
    @WorkspaceId(WorkspaceIdPipe) workspaceId: string,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' }))
    idempotencyKey: string,
    @Body() body: CreateBulkMoveDto,
  ) {
    return this.bulkMoveService.submit(workspaceId, idempotencyKey, body);
  }

  @Get('bulk-move/:jobId')
  getBulkMoveStatus(
    @WorkspaceId(WorkspaceIdPipe) workspaceId: string,
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ) {
    return this.bulkMoveService.getStatus(workspaceId, jobId);
  }

  @Post()
  create(
    @WorkspaceId(WorkspaceIdPipe) workspaceId: string,
    @Body() body: CreateOpportunityDto,
  ) {
    return this.opportunitiesService.create(workspaceId, body);
  }

  @Get()
  list(
    @WorkspaceId(WorkspaceIdPipe) workspaceId: string,
    @Query() query: OpportunityPaginationQuery,
  ) {
    return this.opportunitiesService.list(workspaceId, query);
  }

  @Patch(':id/stage')
  moveStage(
    @WorkspaceId(WorkspaceIdPipe) workspaceId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) opportunityId: string,
    @Body() body: MoveOpportunityStageDto,
  ) {
    return this.opportunitiesService.moveStage(
      workspaceId,
      opportunityId,
      body,
    );
  }
}
