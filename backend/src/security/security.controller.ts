import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';

class EventsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unread?: boolean;
}

const WHO = { select: { id: true, username: true, email: true, role: true } } as const;

/**
 * The security notification page. A SUPER_ADMIN sees every event; an ADMIN sees only events about the
 * players they own. The role is re-read from the database, never taken from the token.
 */
@Controller('admin/security')
@UseGuards(AccessGuard, RolesGuard)
@Capabilities('USER_MANAGE')
export class SecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async scope(actorId: string): Promise<{ actor: { id: string; role: Role }; where: Prisma.SecurityEventWhereInput }> {
    const actor = await this.authorization.authorize(actorId, 'USER_MANAGE', 'SECURITY_EVENTS_VIEW');
    if (actor.role === Role.SUPER_ADMIN) return { actor, where: {} };
    // An ADMIN also sees the players of the managers they created; a MANAGER sees only their own players.
    return { actor, where: actor.role === Role.ADMIN ? { OR: [{ ownerAdminId: actor.id }, { topOwnerId: actor.id }] } : { ownerAdminId: actor.id } };
  }

  @Get('events')
  async events(@Req() request: AuthenticatedRequest, @Query() query: EventsQueryDto) {
    const { where } = await this.scope(request.actor.id);
    const [items, unread] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where: { AND: [where, query.unread ? { acknowledgedAt: null } : {}] },
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { subject: WHO, actor: WHO },
      }),
      this.prisma.securityEvent.count({ where: { AND: [where, { acknowledgedAt: null }] } }),
    ]);
    return { unread, items };
  }

  @Post('events/:eventId/acknowledge')
  async acknowledge(@Req() request: AuthenticatedRequest, @Param('eventId', ParseUUIDPipe) eventId: string) {
    const { actor, where } = await this.scope(request.actor.id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.securityEvent.updateMany({
        where: { AND: [where, { id: eventId, acknowledgedAt: null }] },
        data: { acknowledgedAt: new Date(), acknowledgedById: actor.id },
      });
      // Already acknowledged, or outside this administrator's scope: indistinguishable, on purpose.
      if (updated.count !== 1) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found.' });
      await tx.auditLog.create({
        data: { actorId: actor.id, targetType: 'SECURITY_EVENT', targetId: eventId, action: 'SECURITY_EVENT_ACKNOWLEDGED', result: 'SUCCESS' },
      });
      return { id: eventId };
    });
  }
}
