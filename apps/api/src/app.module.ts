import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './common/prisma/prisma.module';
import { EventsModule } from './common/events/events.module';
import { AuditModule } from './common/audit/audit.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { TenantContextMiddleware } from './common/tenant-context.interceptor';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { AuthModule } from './auth/auth.module';
import { CredentialingModule } from './modules/credentialing/credentialing.module';
import { ConsentModule } from './modules/consent/consent.module';
import { IntakeModule } from './modules/intake/intake.module';
import { MatchingModule } from './modules/matching/matching.module';
import { ClinicalDocumentationModule } from './modules/clinical-documentation/clinical-documentation.module';
import { TreatmentPlanningModule } from './modules/treatment-planning/treatment-planning.module';
import { PsychometricsModule } from './modules/psychometrics/psychometrics.module';
import { OutcomesModule } from './modules/outcomes/outcomes.module';
import { WearablesModule } from './modules/wearables/wearables.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CliniciansModule } from './modules/clinicians/clinicians.module';
import { CrmModule } from './modules/crm/crm.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { RiskModule } from './modules/risk/risk.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { InterventionModule } from './modules/intervention/intervention.module';
import { DiagnosisModule } from './modules/diagnosis/diagnosis.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RegistryModule } from './modules/registry/registry.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './health/health.module';

/**
 * The modular monolith root. Each bounded context is a Nest module. Cross-cutting
 * infrastructure (Prisma, EventBus, Audit, Realtime, AI Gateway) is global so
 * contexts depend on stable ports, not on each other's internals.
 *
 * Phase 1 vertical slice active here: Auth → Intake/Screening → Matching/Assignment
 * (+ AI Gateway, Audit). Remaining 24 contexts are documented and scaffolded to
 * slot in as their own modules (see docs/technical/01-bounded-contexts.md).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Needed here (not just per-module) so the global TenantContextMiddleware
    // below can inject JwtService — it independently verifies the access
    // token to populate tenant context before req.principal exists. See
    // tenant-context.interceptor.ts for why it can't simply read req.principal.
    JwtModule.register({}),
    // Global infrastructure
    PrismaModule,
    EventsModule,
    AuditModule,
    RealtimeModule,
    AiGatewayModule,
    // Cross-cutting API security (doc 04-api-design.md §8 Idempotency, §9 Rate
    // limiting; 06-security-and-rbac.md). Global — every route gets the
    // default rate limit; individual routes tighten it or add idempotent
    // replay via decorators/interceptors (see the controllers themselves).
    RateLimitModule,
    IdempotencyModule,
    // Bounded contexts (Phase 1)
    AuthModule,
    // Bounded contexts (Phase 2)
    CredentialingModule,
    ConsentModule,
    IntakeModule,
    MatchingModule,
    ClinicalDocumentationModule,
    TreatmentPlanningModule,
    PsychometricsModule,
    OutcomesModule,
    WearablesModule,
    ClientsModule,
    CliniciansModule,
    SchedulingModule,
    // Bounded contexts (Phase 2 — CRM & Referrals, ctx 29)
    CrmModule,
    // Bounded contexts (Phase 3 — Communications Hub, ctx 30)
    CommunicationsModule,
    // Bounded contexts (Phase 4 — Risk & Crisis, ctx 21)
    RiskModule,
    // Bounded contexts (Phase 6 — Payments/Accounting/Payouts, ctx 24/25/26)
    FinanceModule,
    // Bounded contexts (Phase 6 — Reports/National Analytics, ctx 27/28)
    AnalyticsModule,
    // Bounded contexts (Wave C — Intervention Tracking / Diagnosis Support /
    // Documents, ctx 15 / 13 / 23): Prisma models already existed; this wave
    // adds the first service/controller code for them.
    InterventionModule,
    DiagnosisModule,
    DocumentsModule,
    // Bounded contexts (Wave E — Tenant/Clinic Network, Client Registry,
    // Psychologist Registry, Admin Configuration, ctx 2/3/4/27 per
    // docs/technical/01-bounded-contexts.md): the last zero-grade business
    // modules. Prisma models (Tenant, Clinic, Client, Psychologist, User,
    // FeatureFlag) already existed; this wave adds the ADMIN write surface
    // for people (Registry) and tenant/clinic/feature-flag config (Admin).
    RegistryModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  /**
   * RLS tenant-context wiring (doc 00-architecture-overview.md §4), applied
   * as MIDDLEWARE (not an interceptor or a guard — two earlier designs were
   * tried and empirically rejected; see common/tenant-context.interceptor.ts
   * for the full story) across every route, ahead of Nest's guards ->
   * interceptors -> pipes -> handler pipeline. It wraps the rest of the
   * request in `TenantContext.run({tenantId}, () => next())`, which is what
   * makes the AsyncLocalStorage-bound tenantId reliably reach every guard
   * (including ClinicalWriteGuard's own DB-querying license check),
   * interceptor, and — ultimately — the RLS Prisma extension's queries.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
