import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, RecordWearableMetricInput, WearableMetricDto, WearableRollup } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

type MetricRow = {
  id: string;
  deviceId: string;
  kind: string;
  value: number;
  unit: string | null;
  recordedAt: Date;
};

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;

/**
 * Wearables longitudinal-signal context. Metrics are ingested one at a time
 * from a connected device and rolled up into a windowed summary — averaged
 * HRV/sleep/resting-HR plus a daily series for a sparkline. The rollup is
 * deliberately descriptive, never diagnostic (see `arousalNote`).
 */
@Injectable()
export class WearablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ingest(principal: AuthPrincipal, input: RecordWearableMetricInput): Promise<WearableMetricDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const deviceId = await this.resolveDeviceId(principal, input);

    const metric = await this.prisma.wearableMetric.create({
      data: {
        tenantId: principal.tenantId,
        deviceId,
        kind: input.kind,
        value: input.value,
        unit: input.unit,
        recordedAt: new Date(input.recordedAt),
      },
    });
    await this.prisma.wearableDevice.update({
      where: { id: deviceId },
      data: { lastSyncAt: new Date() },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'wearable.metric.ingested',
      entityType: 'WearableMetric',
      entityId: metric.id,
      after: { clientId: input.clientId, kind: input.kind, value: input.value },
    });

    return this.toMetricDto(metric);
  }

  async getRollup(principal: AuthPrincipal, clientId: string, windowDaysInput?: number): Promise<WearableRollup> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const windowDays = this.clampWindowDays(windowDaysInput);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - windowDays);
    since.setUTCHours(0, 0, 0, 0);

    const metrics = await this.prisma.wearableMetric.findMany({
      where: {
        tenantId: principal.tenantId,
        recordedAt: { gte: since },
        device: { clientId },
      },
      orderBy: { recordedAt: 'asc' },
    });

    return this.computeRollup(metrics, windowDays);
  }

  /** Used by other read-models (e.g. ClinicalSummary) to embed a rollup only when a device is connected. */
  async hasConnectedDevice(tenantId: string, clientId: string): Promise<boolean> {
    const device = await this.prisma.wearableDevice.findFirst({ where: { tenantId, clientId } });
    return !!device;
  }

  private async resolveDeviceId(principal: AuthPrincipal, input: RecordWearableMetricInput): Promise<string> {
    if (input.deviceId) {
      const device = await this.prisma.wearableDevice.findFirst({
        where: { id: input.deviceId, clientId: input.clientId, tenantId: principal.tenantId },
      });
      if (!device) throw new NotFoundException('Wearable device not found for this client');
      return device.id;
    }

    const devices = await this.prisma.wearableDevice.findMany({
      where: { clientId: input.clientId, tenantId: principal.tenantId },
    });
    if (devices.length === 1) return devices[0].id;
    if (devices.length === 0) {
      throw new NotFoundException('No wearable device registered for this client; provide deviceId');
    }
    throw new BadRequestException('Client has multiple wearable devices; deviceId is required to disambiguate');
  }

  private clampWindowDays(input?: number): number {
    if (input === undefined || Number.isNaN(input)) return DEFAULT_WINDOW_DAYS;
    return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.round(input)));
  }

  private computeRollup(metrics: MetricRow[], windowDays: number): WearableRollup {
    const byDate = new Map<string, { hrv: number[]; sleepMinutes: number[] }>();
    const hrvAll: number[] = [];
    const rhrAll: number[] = [];
    const sleepMinutesAll: number[] = [];

    for (const m of metrics) {
      const dateKey = m.recordedAt.toISOString().slice(0, 10);
      const bucket = byDate.get(dateKey) ?? { hrv: [], sleepMinutes: [] };
      if (m.kind === 'hrv') {
        bucket.hrv.push(m.value);
        hrvAll.push(m.value);
      } else if (m.kind === 'sleep_minutes') {
        bucket.sleepMinutes.push(m.value);
        sleepMinutesAll.push(m.value);
      } else if (m.kind === 'rhr') {
        rhrAll.push(m.value);
      }
      byDate.set(dateKey, bucket);
    }

    const series = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        hrvMs: this.round(this.avg(bucket.hrv), 1),
        sleepHours: this.minutesToHours(this.avg(bucket.sleepMinutes)),
      }));

    const avgHrvMs = this.round(this.avg(hrvAll), 1);
    const avgSleepHours = this.minutesToHours(this.avg(sleepMinutesAll));
    const restingHrBpm = this.round(this.avg(rhrAll), 1);

    return {
      windowDays,
      avgHrvMs,
      avgSleepHours,
      restingHrBpm,
      arousalNote: this.buildArousalNote(series, avgSleepHours),
      series,
    };
  }

  /** Context-not-diagnosis phrasing: compares first vs. second half of the HRV series for a coarse recovery trend. */
  private buildArousalNote(series: { date: string; hrvMs: number | null }[], avgSleepHours: number | null): string {
    const withHrv = series.filter((s) => s.hrvMs !== null) as { date: string; hrvMs: number }[];
    if (withHrv.length === 0) {
      return 'No wearable data available for this window — context, not diagnosis.';
    }

    const parts: string[] = [];
    if (withHrv.length >= 2) {
      const mid = Math.floor(withHrv.length / 2);
      const firstAvg = this.avg(withHrv.slice(0, mid).map((s) => s.hrvMs));
      const secondAvg = this.avg(withHrv.slice(mid).map((s) => s.hrvMs));
      const delta = firstAvg !== null && secondAvg !== null ? secondAvg - firstAvg : null;
      if (delta !== null && delta <= -3) {
        parts.push('Recovery trending down this week — review sleep, caffeine, stress.');
      } else if (delta !== null && delta >= 3) {
        parts.push('Recovery trending up this week — current routines appear to be helping.');
      } else {
        parts.push('Recovery holding steady this week.');
      }
    } else {
      parts.push('Limited HRV data this window.');
    }

    if (avgSleepHours !== null && avgSleepHours < 6.5) {
      parts.push('Sleep duration is below the typical recommended range.');
    }

    parts.push('Context, not diagnosis — worth raising with your clinician if the pattern persists.');
    return parts.join(' ');
  }

  private avg(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private round(value: number | null, digits: number): number | null {
    if (value === null) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private minutesToHours(minutes: number | null): number | null {
    if (minutes === null) return null;
    return this.round(minutes / 60, 2);
  }

  private toMetricDto(metric: MetricRow): WearableMetricDto {
    return {
      id: metric.id,
      deviceId: metric.deviceId,
      kind: metric.kind as WearableMetricDto['kind'],
      value: metric.value,
      unit: metric.unit,
      recordedAt: metric.recordedAt.toISOString(),
    };
  }
}
