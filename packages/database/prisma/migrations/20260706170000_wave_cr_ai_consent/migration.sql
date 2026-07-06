-- WAVE CR — AI-consent remediation (docs/10-10-PROGRAM.md WAVE CR): wires
-- AI_ASSISTED_ANALYSIS into the ConsentType enum so the AI Gateway can gate
-- real model calls behind an explicit, revocable client consent (APA AI
-- guidance 2025 / GDPR Art.22). Purely ADDITIVE — a new enum value only; no
-- existing value renamed/removed, no column altered. This value is NOT added
-- to REQUIRED_CONSENT_VERSIONS: it gates AI usage only, never intake/care.
ALTER TYPE "ConsentType" ADD VALUE 'AI_ASSISTED_ANALYSIS';
