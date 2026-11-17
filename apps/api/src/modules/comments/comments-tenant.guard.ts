import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { CommentTargetTypeSchema, UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { CommentsRepository } from "./comments.repository.js";

@Injectable()
export class CommentsTenantGuard implements CanActivate {
  constructor(
    @Inject(CommentsRepository) private readonly repository: CommentsRepository,
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(VerifiedEmailGuard) private readonly verifiedEmailGuard: VerifiedEmailGuard,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    this.verifiedEmailGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const commentId = singleParam(request.params.commentId);
    let workspaceId: string | null;
    if (commentId) {
      if (!UuidV7Schema.safeParse(commentId).success) {
        throw this.invalidTarget();
      }
      const comment = await this.repository.findCommentById(commentId);
      workspaceId = comment?.workspaceId ?? null;
    } else {
      const source = request.method === "GET" ? request.query : request.body;
      const targetType = readString(source, "targetType");
      const targetId = readString(source, "targetId");
      const parsedType = CommentTargetTypeSchema.safeParse(targetType);
      if (!parsedType.success || !targetId || !UuidV7Schema.safeParse(targetId).success) {
        throw this.invalidTarget();
      }
      const target = await this.repository.findTarget(parsedType.data, targetId);
      workspaceId = target?.workspaceId ?? null;
    }

    if (!workspaceId) {
      throw new NotFoundException({
        code: "COMMENT_TARGET_NOT_FOUND",
        message: "The requested comment target was not found.",
      });
    }
    request.params.workspaceId = workspaceId;
    return this.tenantGuard.canActivate(context);
  }

  private invalidTarget(): BadRequestException {
    return new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "A valid comment target is required.",
    });
  }
}

function singleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}
