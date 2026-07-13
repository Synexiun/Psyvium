import { createHmac } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';

export interface SiemEvent {
  type: string;
  severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
  tenantId: string;
  /** PHI-minimized payload — ids and status only, never free-text clinical content. */
  payload: Record<string, unknown>;
  occurredAt?: string;
}

/**
 * SIEM / WORM-style export seam for security-relevant events.
 *
 * Activate-on-config (any combination):
 *   VPSY_SIEM_WEBHOOK_URL     — HTTPS POST JSON (optional VPSY_SIEM_WEBHOOK_SECRET HMAC)
 *   VPSY_SIEM_LOCAL_DIR       — append-only JSONL files (staging / air-gapped)
 *
 * When neither is set, emit() is a structured log only (honest no-export).
 * Never blocks the clinical path on SIEM failure (log + continue).
 */
@Injectable()
export class SiemExportService {
  private readonly logger = new Logger(SiemExportService.name);

  get webhookConfigured(): boolean {
    return Boolean(process.env.VPSY_SIEM_WEBHOOK_URL?.trim());
  }

  get localConfigured(): boolean {
    return Boolean(process.env.VPSY_SIEM_LOCAL_DIR?.trim());
  }

  get isConfigured(): boolean {
    return this.webhookConfigured || this.localConfigured;
  }

  async emit(event: SiemEvent): Promise<{ delivered: boolean; channels: string[] }> {
    const body = {
      schema: 'vpsy.siem.v1',
      type: event.type,
      severity: event.severity,
      tenantId: event.tenantId,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      payload: event.payload,
    };
    const json = JSON.stringify(body);
    this.logger.log(json);

    const channels: string[] = ['log'];
    let delivered = false;

    if (this.localConfigured) {
      try {
        await this.appendLocal(json);
        channels.push('local');
        delivered = true;
      } catch (err) {
        this.logger.error(`SIEM local append failed: ${(err as Error).message}`);
      }
    }

    if (this.webhookConfigured) {
      try {
        await this.postWebhook(json);
        channels.push('webhook');
        delivered = true;
      } catch (err) {
        this.logger.error(`SIEM webhook failed: ${(err as Error).message}`);
      }
    }

    return { delivered, channels };
  }

  private async appendLocal(jsonLine: string): Promise<void> {
    const root = process.env.VPSY_SIEM_LOCAL_DIR!.trim();
    await mkdir(root, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const file = join(root, `siem-${day}.jsonl`);
    await appendFile(file, `${jsonLine}\n`, { encoding: 'utf8', flag: 'a' });
  }

  private async postWebhook(json: string): Promise<void> {
    const url = process.env.VPSY_SIEM_WEBHOOK_URL!.trim();
    const secret = process.env.VPSY_SIEM_WEBHOOK_SECRET?.trim();
    const timeoutMs = Number(process.env.VPSY_SIEM_WEBHOOK_TIMEOUT_MS ?? 5_000);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'vpsy-siem-export/1',
    };
    if (secret) {
      const sig = createHmac('sha256', secret).update(json, 'utf8').digest('hex');
      headers['x-vpsy-signature'] = `sha256=${sig}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: json,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`status=${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
