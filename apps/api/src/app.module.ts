import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { EventsModule } from './common/events/events.module';
import { AuditModule } from './common/audit/audit.module';
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
import { HealthModule } from './health/health.module';

/**
 * The modular monolith root. Each bounded context is a Nest module. Cross-cutting
 * infrastructure (Prisma, EventBus, Audit, AI Gateway) is global so contexts
 * depend on stable ports, not on each other's internals.
 *
 * Phase 1 vertical slice active here: Auth → Intake/Screening → Matching/Assignment
 * (+ AI Gateway, Audit). Remaining 24 contexts are documented and scaffolded to
 * slot in as their own modules (see docs/technical/01-bounded-contexts.md).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global infrastructure
    PrismaModule,
    EventsModule,
    AuditModule,
    AiGatewayModule,
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
    HealthModule,
  ],
})
export class AppModule {}
