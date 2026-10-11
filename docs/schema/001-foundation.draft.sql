-- DESIGN DRAFT ONLY. Never applied by this app. Review against the chosen Postgres
-- host and authentication provider before turning this into an executable migration.
-- No policies are created: ordinary roles get DENY-ALL with forced RLS.
-- Table owners/BYPASSRLS roles and service credentials need separate review.
-- Never run the web app as a superuser or BYPASSRLS role.
BEGIN;
CREATE TABLE hc_tenants (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hc_memberships (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE hc_business_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES hc_tenants(id),
  version bigint NOT NULL CHECK (version > 0),
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hc_checkpoints (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  conversation_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  state jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id)
);
CREATE TABLE hc_approvals (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  action_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES hc_checkpoints(tenant_id, conversation_id)
);
CREATE TABLE hc_usage_reservations (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  id uuid NOT NULL,
  request_id text NOT NULL,
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd >= 0),
  settled_micro_usd bigint CHECK (settled_micro_usd >= 0),
  status text NOT NULL CHECK (status IN ('reserved', 'settled', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, request_id)
);
ALTER TABLE hc_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_business_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_business_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_usage_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hc_tenants, hc_memberships, hc_business_profiles, hc_checkpoints, hc_approvals, hc_usage_reservations FROM PUBLIC;
-- Still required: verified-session-bound membership policies; concurrent atomic
-- tenant/platform budget reservations; approved immutable action execution;
-- reconciliation; retention/deletion jobs; backup/access reviews; isolation tests.
-- This schema alone provides NO usable budget limiter or authentication.
COMMIT;
