import { EventBus, Events } from '../events/event-bus.service';
import { RealtimeBridgeService } from './realtime-bridge.service';
import type { RealtimeGateway } from './realtime.gateway';

/**
 * PHI minimization on the wire (`dto/realtime.ts` doc comment): a `LiveEvent`
 * may only ever carry ids/refs/status/timestamps, never clinical free-text.
 * This targets Messaging's (context 14) `MessageSent` mapping specifically,
 * since a text-message body is exactly the kind of payload this rule exists
 * to keep off the socket — the recipient must reload the thread over the
 * authenticated REST API to see the actual text.
 */
describe('RealtimeBridgeService — Messaging (ctx 14) MessageSent mapping', () => {
  function makeBridge() {
    const bus = new EventBus();
    const emittedToTenant: unknown[] = [];
    const gateway = {
      emitToTenant: (_tenantId: string, event: unknown) => emittedToTenant.push(event),
      emitToUser: jest.fn(),
    } as unknown as RealtimeGateway;
    const bridge = new RealtimeBridgeService(bus, gateway);
    bridge.onModuleInit();
    return { bus, gateway, bridge, emittedToTenant };
  }

  it('maps MessageSent to a body-free CommsMessage envelope (ids/refs only)', async () => {
    const { bus, emittedToTenant } = makeBridge();

    await bus.publish(Events.MessageSent, 'tenant_demo', {
      messageId: 'msg_1',
      threadId: 'thread_1',
      senderId: 'user_client_1',
      // Defense-in-depth: even if a future publisher accidentally attached a
      // body field to the domain-event payload, the mapper must hand-pick
      // fields rather than spread the payload, so this must never surface.
      body: 'This must never reach the socket',
    });

    expect(emittedToTenant).toHaveLength(1);
    const event = emittedToTenant[0] as { type: string; entity: { type: string; id: string }; data?: object };
    expect(event.type).toBe('comms.message');
    expect(event.entity).toEqual({ type: 'Message', id: 'msg_1' });
    expect(event.data).toEqual({ threadId: 'thread_1' });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('body');
    expect(serialized).not.toContain('This must never reach the socket');
  });
});
