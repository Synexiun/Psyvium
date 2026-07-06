import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { jwtAccessSecret } from '../config/jwt-secrets';
import { REALTIME_SOCKET_EVENT, type LiveEvent } from '@vpsy/contracts';

/** A socket only ever joins its own tenant's room — this is the tenant-isolation boundary. */
export const tenantRoom = (tenantId: string): string => `tenant:${tenantId}`;
/** A socket also joins its own user room, so user-targeted events (e.g. "assigned to you") reach it. */
export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Real-time push gateway (docs/superpowers/specs/2026-07-06-live-data-command-center-design.md,
 * SP3 — "WebSocket live push"). This is the ONLY piece of infrastructure that
 * knows about sockets; `RealtimeBridgeService` only knows about the EventBus
 * and this gateway's room-emit API, so bounded contexts stay decoupled from
 * the transport (hexagonal: this module is infrastructure, not a context).
 *
 * SECURITY — tenant isolation is mandatory, not a nice-to-have:
 *  - The handshake is authenticated with the SAME short-lived access token
 *    used for HTTP (verified with `jwtAccessSecret()`, the identical secret
 *    JwtAuthGuard uses). Any missing/invalid/expired token disconnects the
 *    socket immediately — there is no unauthenticated realtime channel.
 *  - A socket is joined ONLY to `tenant:{tenantId}` (from the verified
 *    token, never client-supplied) and `user:{userId}`. There is no
 *    broadcast-to-all path and no way for a socket to join another room.
 */
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new UnauthorizedException('Missing token');

      const payload = await this.jwt.verifyAsync(token, { secret: jwtAccessSecret() });
      const userId: string | undefined = payload.sub;
      const tenantId: string | undefined = payload.tenantId;
      if (!userId || !tenantId) throw new UnauthorizedException('Malformed token');

      client.data.userId = userId;
      client.data.tenantId = tenantId;
      await client.join(tenantRoom(tenantId));
      await client.join(userRoom(userId));
      this.logger.debug(`socket ${client.id} connected (tenant=${tenantId})`);
    } catch (err) {
      this.logger.warn(`rejected unauthenticated socket ${client.id}: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`socket ${client.id} disconnected`);
  }

  /** Bearer token from `auth.token` (socket.io client `auth` option) or an Authorization header. */
  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth as Record<string, unknown> | undefined;
    const fromAuth = typeof auth?.token === 'string' ? auth.token : undefined;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }

  /** Tenant-wide push — the default target for every curated real-time event. */
  emitToTenant(tenantId: string, event: LiveEvent): void {
    this.server?.to(tenantRoom(tenantId)).emit(REALTIME_SOCKET_EVENT, event);
  }

  /** Additionally push to one user's private room (e.g. "an escalation was assigned to you"). */
  emitToUser(userId: string, event: LiveEvent): void {
    this.server?.to(userRoom(userId)).emit(REALTIME_SOCKET_EVENT, event);
  }
}
