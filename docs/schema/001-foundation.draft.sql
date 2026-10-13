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
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE hc_business_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES hc_tenants(id),
  version bigint NOT NULL CHECK (version > 0),
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hc_workflows (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  current_draft_version bigint NOT NULL CHECK (current_draft_version > 0),
  published_version bigint CHECK (published_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE hc_workflow_versions (
  tenant_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workflow_id, version),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES hc_workflows(tenant_id, id)
);
CREATE TABLE hc_knowledge_sources (
  tenant_id uuid NOT NULL REFERENCES hc_tenants(id),
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('manual', 'website', 'file')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('draft', 'processing', 'ready', 'error', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
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
ALTER TABLE hc_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_workflow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_knowledge_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_usage_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_usage_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hc_tenants, hc_memberships, hc_business_profiles, hc_workflows, hc_workflow_versions, hc_knowledge_sources, hc_checkpoints, hc_approvals, hc_usage_reservations FROM PUBLIC;
REVOKE ALL ON hc_tenants, hc_memberships, hc_business_profiles, hc_workflows, hc_workflow_versions, hc_knowledge_sources, hc_checkpoints, hc_approvals, hc_usage_reservations FROM anon, authenticated;
-- Still required: verified-session-bound membership policies; concurrent atomic
-- tenant/platform budget reservations; approved immutable action execution;
-- reconciliation; retention/deletion jobs; backup/access reviews; isolation tests.
-- Before any grant: add SELECT/INSERT/UPDATE/DELETE policies for authenticated
-- users, including both USING and WITH CHECK on UPDATE. Then grant only the
-- operations each role needs. This schema alone provides NO usable budget
-- limiter or authentication.
COMMIT;
