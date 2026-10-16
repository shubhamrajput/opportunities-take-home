import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateOpportunityDto,
  MoveOpportunityStageDto,
  OpportunityPaginationQuery,
} from './dto.js';
import { OpportunitiesService } from './opportunities.service.js';
import { WorkspaceId, WorkspaceIdPipe } from './workspace-id.decorator.js';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

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
