import {
  createParamDecorator,
  ExecutionContext,
  ParseUUIDPipe,
} from '@nestjs/common';

export const WorkspaceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    return request.headers['x-workspace-id'];
  },
);

export const WorkspaceIdPipe = new ParseUUIDPipe({ version: '4' });
