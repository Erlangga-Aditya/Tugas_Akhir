import { type NextRequest } from 'next/server';
import { sseEmitter, type SystemEventPayload } from '@/lib/sse';
import { getAuthContext } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/v1/events/stream
 *
 * Server-Sent Events untuk notifikasi realtime (pesanan baru, resi, fulfillment, sync).
 * Setiap koneksi difilter berdasarkan tenant pemilik sesi — event milik tenant lain
 * tidak pernah dikirim ke koneksi ini.
 */
export async function GET(request: NextRequest) {
  let tenantId: string;
  try {
    tenantId = getAuthContext(request).tenantId;
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          return false;
        }
      };

      send(
        `event: connected\ndata: ${JSON.stringify({
          status: 'connected',
          time: new Date().toISOString(),
        })}\n\n`,
      );

      const onSystemEvent = (event: SystemEventPayload) => {
        // Event tanpa tenant dianggap global (mis. info sistem) — hanya event
        // yang punya tenantId dan bukan milik tenant ini yang disaring keluar.
        if (event.tenantId && event.tenantId !== tenantId) return;
        send(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
      };

      sseEmitter.on('system-event', onSystemEvent);

      const heartbeat = setInterval(() => {
        if (!send(`: ping\n\n`)) clearInterval(heartbeat);
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        sseEmitter.off('system-event', onSystemEvent);
      };
      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // agar Nginx tidak menahan buffer
    },
  });
}
