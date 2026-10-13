-- DESIGN DRAFT ONLY. Apply after 001-foundation.draft.sql has been reviewed.
-- This intentionally creates no access policies and grants no client access.
-- Authentication, membership policies, and isolation tests are required first.
BEGIN;

ALTER TABLE hc_knowledge_sources
  RENAME COLUMN kind TO origin;

ALTER TABLE hc_knowledge_sources
  DROP CONSTRAINT hc_knowledge_sources_kind_check,
  DROP CONSTRAINT hc_knowledge_sources_status_check,
  ADD COLUMN kind text NOT NULL DEFAULT 'document'
    CHECK (kind IN ('hours', 'service', 'faq', 'policy', 'document')),
  ADD COLUMN language text NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'fa', 'zh')),
  ADD COLUMN content text NOT NULL DEFAULT ''
    CHECK (char_length(content) <= 12000),
  ADD COLUMN content_hash text,
  ADD COLUMN current_version bigint NOT NULL DEFAULT 1
    CHECK (current_version > 0),
  ADD COLUMN approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT hc_knowledge_sources_origin_check
    CHECK (origin IN ('manual', 'upload', 'website')),
  ADD CONSTRAINT hc_knowledge_sources_status_check
    CHECK (status IN ('draft', 'processing', 'approved', 'outdated', 'error', 'archived')),
  ADD CONSTRAINT hc_knowledge_sources_approval_check
    CHECK (
      (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR status <> 'approved'
    );

CREATE TABLE hc_knowledge_source_versions (
  tenant_id uuid NOT NULL,
  source_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 12000),
  language text NOT NULL CHECK (language IN ('en', 'fa', 'zh')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_id, version),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES hc_knowledge_sources(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE hc_knowledge_chunks (
  tenant_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version bigint NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  start_index integer CHECK (start_index >= 0),
  token_count integer CHECK (token_count > 0),
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', content)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_id, source_version, ordinal),
  FOREIGN KEY (tenant_id, source_id, source_version)
    REFERENCES hc_knowledge_source_versions(tenant_id, source_id, version)
    ON DELETE CASCADE
);

CREATE INDEX hc_knowledge_sources_tenant_status_idx
  ON hc_knowledge_sources (tenant_id, status, language, kind);
CREATE INDEX hc_knowledge_chunks_source_idx
  ON hc_knowledge_chunks (tenant_id, source_id, source_version);
CREATE INDEX hc_knowledge_chunks_search_idx
  ON hc_knowledge_chunks USING gin (search_vector);

ALTER TABLE hc_knowledge_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_knowledge_source_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE hc_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hc_knowledge_chunks FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hc_knowledge_source_versions, hc_knowledge_chunks
  FROM PUBLIC, anon, authenticated;

-- Vector columns are intentionally deferred. Their dimension and distance
-- operator must match one selected embedding model. When added, retrieval must
-- still filter by tenant membership and approved source versions under RLS.
-- Uploaded binaries belong in a private Storage bucket; only extracted text,
-- hashes, and metadata belong in these tables.
-- Required before grants: authenticated membership policies for every command,
-- storage object policies, approval transactions, and cross-tenant tests.

COMMIT;
