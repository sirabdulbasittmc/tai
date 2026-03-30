# TMC AI Intelligence -- Database Design

**Last Updated**: 2026-03-28

## Overview

Multi-tenant PostgreSQL database with Prisma 6 ORM for unified storage: tenants, users, authentication, vector embeddings, chat history, user memory, audit logs, scheduled tasks, and system configuration. Follows the HRAPR pattern (system_config key-value store, AES-256-GCM encryption). All tables include `client_number` for tenant isolation.

**Database**: `tmcai` on PostgreSQL 15+
**ORM**: Prisma 6 (prisma-client-js generator)
**Schema**: `server/prisma/schema.prisma`
**Embeddings**: Stored as JSON arrays (future migration to pgvector planned)

---

## Entity Relationship Diagram

```
tenants (client_number PK -- tenant registry)
    |
    +----< system_config (composite PK: client_number + key, encrypted sensitive values)
    |
    +----< roles ----< users ----< sessions (token-based auth)
    |                    |
    |                    +----< conversations ----< messages
    |                    |
    |                    +----< user_memory (AI-generated durable facts)
    |                    |
    |                    +----< audit_log (PII-masked query logs)
    |                    |
    |                    +----< scheduled_tasks (cron-based AI reports)
    |
    +----< documents ----< chunks (embeddings as JSON, ACL metadata)

All tables include client_number for tenant isolation.
```

### Relationship Summary

| Parent | Child | Relationship | On Delete |
|--------|-------|-------------|-----------|
| tenants | system_config | One-to-Many (client_number) | -- |
| tenants | roles | One-to-Many (client_number) | -- |
| tenants | users | One-to-Many (client_number) | -- |
| tenants | documents | One-to-Many (client_number) | -- |
| roles | users | One-to-Many (role_id FK) | -- |
| users | sessions | One-to-Many (user_id FK) | -- |
| users | conversations | One-to-Many (user_id FK) | -- |
| users | user_memory | One-to-Many (user_id FK) | -- |
| users | audit_log | One-to-Many (user_id FK, nullable) | -- |
| users | scheduled_tasks | One-to-Many (user_id FK) | -- |
| conversations | messages | One-to-Many (conversation_id FK) | CASCADE |
| documents | chunks | One-to-Many (document_id FK) | CASCADE |

---

## Tables

### 1. tenants

Multi-tenant registry. Every other table references `client_number` from this table for tenant isolation.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| client_number | VARCHAR(20) | **PK** | Unique tenant identifier (e.g., "TMC") |
| name | VARCHAR(100) | NOT NULL | Tenant display name |
| is_active | BOOLEAN | DEFAULT true | Whether the tenant is active |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | Last modification time |

**Prisma model**: `Tenant` -> table `tenants`

---

### 2. system_config

Encrypted key-value store for application settings (HRAPR pattern). Sensitive values are encrypted with AES-256-GCM. Scoped per tenant.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| client_number | VARCHAR(20) | **Composite PK**, FK -> tenants.client_number | Tenant identifier |
| key | VARCHAR(50) | **Composite PK** | Setting name |
| value | TEXT | NOT NULL | Plain text or AES-256-GCM encrypted (format: `iv:authTag:ciphertext`, all base64) |
| is_sensitive | BOOLEAN | DEFAULT false | If true, value is encrypted |
| description | VARCHAR(255) | NULL | Human-readable description |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | Last modification time |

**Prisma model**: `SystemConfig` -> table `system_config`
**Primary key**: Composite `@@id([clientNumber, key])`

**Encryption details**:
- Algorithm: `aes-256-gcm`
- IV: 16 bytes random per encryption
- Auth tag: 16 bytes
- Key: first 32 bytes of `ENCRYPTION_KEY` env var (UTF-8 encoded)
- Stored format: `{iv_base64}:{authTag_base64}:{ciphertext_base64}`

---

### 3. roles

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Role ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| name | VARCHAR(50) | NOT NULL | Role name |
| allowed_sources | TEXT[] | DEFAULT '{}' | Data sources this role can access |
| allowed_departments | TEXT[] | DEFAULT '{}' | Departments data this role can view |
| is_admin | BOOLEAN | DEFAULT false | Full access flag |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |

**Prisma model**: `Role` -> table `roles`
**Unique constraint**: `@@unique([clientNumber, name])` -- role names unique per tenant

**Seed data**:

| name | allowed_sources | allowed_departments | is_admin |
|------|----------------|---------------------|----------|
| admin | ['all'] | ['all'] | true |
| management | ['all'] | ['all'] | false |
| hr | ['google_drive'] | ['HR', 'Management'] | false |
| sales | ['google_drive'] | ['Sales', 'Pre-Sales'] | false |
| delivery | ['google_drive'] | ['Delivery', 'Projects'] | false |
| viewer | ['google_drive'] | [] | false |

---

### 4. users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | User ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| empcode | VARCHAR(20) | NOT NULL | Employee code (links to TMC HR data) |
| name | VARCHAR(100) | NOT NULL | Full name |
| email | VARCHAR(100) | NOT NULL | Email address |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt hashed password (10 rounds) |
| department | VARCHAR(50) | NULL | Department name |
| role_id | INT | FK -> roles.id, NOT NULL | User's role |
| is_active | BOOLEAN | DEFAULT true | Account status |
| last_login_at | TIMESTAMPTZ | NULL | Last successful login |
| failed_attempts | INT | DEFAULT 0 | Consecutive failed login attempts |
| locked_until | TIMESTAMPTZ | NULL | Account lockout expiry (set after 5 failures) |
| job_description | TEXT | NULL | Synced from HR (read-only for user) |
| about_me | TEXT | NULL | User-written personality/background |
| instructions | TEXT | NULL | Custom AI behavior rules |
| tone_preference | VARCHAR(30) | NULL | friendly, formal, executive, casual, technical |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | Last modification time |

**Prisma model**: `User` -> table `users`

**Unique constraints**: `@@unique([clientNumber, empcode])`, `@@unique([clientNumber, email])` -- empcode and email unique per tenant

**Profile fields**:
- `job_description`: HR-managed, read-only for users, synced from centralized HR data
- `about_me`: User-editable personality/background
- `instructions`: User-editable custom AI instructions
- `tone_preference`: User-selectable from predefined options

---

### 5. sessions

Token-based session management. Replaces the HRAPR login_config/access_tokens pattern with a simpler model.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Session ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| token | VARCHAR(255) | UNIQUE, NOT NULL | 64-char hex session token |
| user_id | INT | FK -> users.id, NOT NULL | Session owner |
| expires_at | TIMESTAMPTZ | NOT NULL | Token expiration (72 hours from creation) |
| is_revoked | BOOLEAN | DEFAULT false | Set to true on logout |
| user_agent | VARCHAR(500) | NULL | Browser/client user agent string |
| ip_address | VARCHAR(50) | NULL | Client IP address |
| created_at | TIMESTAMPTZ | DEFAULT now() | Session creation time |

**Prisma model**: `Session` -> table `sessions`

**Token generation**: `crypto.randomBytes(32).toString('hex')` = 64-char hex string

---

### 6. documents

Data source lifecycle tracking. Each row represents a document fetched from an external source.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Document ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| source | VARCHAR(50) | NOT NULL | Connector name (google_drive, bigquery, etc.) |
| source_id | VARCHAR(255) | NULL | External ID (Drive file ID, BQ table name) |
| title | VARCHAR(255) | NOT NULL | Document/section title |
| version | VARCHAR(50) | NULL | Source document version |
| department | VARCHAR(50) | NULL | ACL: which department owns this data |
| last_checked_at | TIMESTAMPTZ | NULL | Last sync check time |
| last_modified_at | TIMESTAMPTZ | NULL | Source file modification time |
| sync_status | VARCHAR(20) | DEFAULT 'pending' | Status: pending, indexed, failed, stale, archived |
| content_hash | VARCHAR(64) | NULL | SHA-256 hash of full document content |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |
| archived_at | TIMESTAMPTZ | NULL | Soft delete timestamp |

**Prisma model**: `Document` -> table `documents`

---

### 7. chunks

Embeddings and chunked content. Currently stores embeddings as JSON arrays; future migration to pgvector planned.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Chunk ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| document_id | INT | FK -> documents.id ON DELETE CASCADE | Parent document |
| content | TEXT | NOT NULL | Chunk text content |
| embedding | JSON | DEFAULT '[]' | 3072-dimensional embedding vector (Gemini embedding-001) |
| chunk_index | INT | NOT NULL | Position within document |
| header_path | TEXT[] | DEFAULT '{}' | Hierarchical headers for this chunk |
| content_hash | VARCHAR(64) | UNIQUE, NOT NULL | SHA-256 hash for change detection |
| department | VARCHAR(50) | NULL | ACL: inherits from parent document |
| source | VARCHAR(50) | NOT NULL | Connector name |
| metadata | JSONB | DEFAULT '{}' | Extensible metadata (key-value) |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |

**Prisma model**: `Chunk` -> table `chunks`

**Indexes**:
- `@@index([documentId])` -- fast lookup by parent document
- `@@index([contentHash])` -- fast deduplication checks
- `@@index([department])` -- fast ACL filtering

**Note**: The `embedding` column is currently `Json` type. When pgvector is installed, this will migrate to `vector(3072)` with an IVFFlat index for efficient similarity search.

---

### 8. conversations

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Conversation ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| user_id | INT | FK -> users.id, NOT NULL | Conversation owner |
| title | VARCHAR(255) | NULL | Auto-generated from first message, or user-set |
| provider | VARCHAR(20) | NULL | Last used AI provider |
| message_count | INT | DEFAULT 0 | Total messages in conversation |
| is_archived | BOOLEAN | DEFAULT false | Soft archive flag |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | Last activity time |

**Prisma model**: `Conversation` -> table `conversations`

---

### 9. messages

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Message ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| conversation_id | INT | FK -> conversations.id ON DELETE CASCADE | Parent conversation |
| role | VARCHAR(10) | NOT NULL | 'user' or 'assistant' |
| content | TEXT | NOT NULL | Message text (may contain markdown, HTML widgets) |
| provider | VARCHAR(20) | NULL | AI provider used (assistant messages only) |
| input_tokens | INT | NULL | Estimated input token count |
| output_tokens | INT | NULL | Estimated output token count |
| response_time_ms | INT | NULL | LLM response time in milliseconds |
| created_at | TIMESTAMPTZ | DEFAULT now() | Message timestamp |

**Prisma model**: `Message` -> table `messages`

---

### 10. user_memory

AI-extracted durable facts about users. Schema is ready; active extraction service is pending (Phase 3).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Memory ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| user_id | INT | FK -> users.id, NOT NULL | Memory owner |
| memory_type | VARCHAR(20) | NOT NULL | Type: 'profile', 'preference', 'insight' |
| summary | TEXT | NOT NULL | AI-extracted durable fact text |
| embedding | JSON | NULL, DEFAULT '[]' | Embedding for relevance-based retrieval |
| confidence | FLOAT | DEFAULT 1.0 | How confident we are this fact is still valid |
| source_conversation_id | INT | NULL | Conversation where this was learned |
| is_active | BOOLEAN | DEFAULT true | Can be deactivated by user |
| created_at | TIMESTAMPTZ | DEFAULT now() | When fact was extracted |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | When fact was last updated |

**Prisma model**: `UserMemory` -> table `user_memory`

---

### 11. audit_log

PII-masked query logging for compliance, analytics, and debugging.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Log entry ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| user_id | INT | FK -> users.id, NULL | Who made the request (NULL for anonymous) |
| masked_query | TEXT | NOT NULL | PII-masked version of user query |
| provider | VARCHAR(20) | NOT NULL | AI provider used |
| chunks_retrieved | INT | DEFAULT 0 | Number of data chunks sent to AI |
| top_score | FLOAT | NULL | Best retrieval similarity score |
| pii_entities_count | INT | DEFAULT 0 | Number of PII entities masked |
| input_tokens | INT | NULL | Estimated input tokens |
| output_tokens | INT | NULL | Estimated output tokens |
| response_time_ms | INT | NOT NULL | Total response time in milliseconds |
| intent_type | VARCHAR(30) | NULL | Classified intent type |
| error | TEXT | NULL | Error message if the request failed |
| created_at | TIMESTAMPTZ | DEFAULT now() | Log timestamp |

**Prisma model**: `AuditLog` -> table `audit_log`

---

### 12. scheduled_tasks

Cron-based AI report generation with email notifications.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | **PK**, auto-increment | Task ID |
| client_number | VARCHAR(20) | FK -> tenants.client_number, NOT NULL | Tenant identifier |
| user_id | INT | FK -> users.id, NOT NULL | Task owner |
| title | VARCHAR(200) | NOT NULL | Task display name |
| prompt | TEXT | NOT NULL | AI prompt to execute |
| cron_expression | VARCHAR(50) | NOT NULL | node-cron compatible cron expression |
| provider | VARCHAR(20) | DEFAULT 'gemini-flash' | AI provider for execution |
| notify_email | VARCHAR(255) | NULL | Comma-separated recipient emails |
| notify_self | BOOLEAN | DEFAULT true | Also email the task owner |
| is_active | BOOLEAN | DEFAULT true | Whether the cron job is active |
| last_run_at | TIMESTAMPTZ | NULL | Last execution time |
| last_result | TEXT | NULL | Last successful AI response (truncated to 10K chars) |
| last_error | TEXT | NULL | Last error message |
| next_run_at | TIMESTAMPTZ | NULL | Estimated next execution time |
| created_at | TIMESTAMPTZ | DEFAULT now() | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT now(), auto-update | Last modification time |

**Prisma model**: `ScheduledTask` -> table `scheduled_tasks`

---

## Seed Data

The seed script (`server/prisma/seed.ts`) creates:

### 0. Tenant

| Field | Value |
|-------|-------|
| client_number | TMC |
| name | TallyMarks Consulting |
| is_active | true |

All seed data below is scoped to tenant "TMC".

### 1. Roles (6 roles, scoped to TMC)

| Role | Sources | Departments | Admin |
|------|---------|-------------|-------|
| admin | all | all | Yes |
| management | all | all | No |
| hr | google_drive | HR, Management | No |
| sales | google_drive | Sales, Pre-Sales | No |
| delivery | google_drive | Delivery, Projects | No |
| viewer | google_drive | (none) | No |

### 2. Admin User (scoped to TMC)

| Field | Value |
|-------|-------|
| client_number | TMC |
| empcode | ADMIN |
| name | System Administrator |
| email | admin@tmc.com |
| password | admin123 (bcrypt hashed) |
| department | IT |
| role | admin |

### 3. System Config (6 entries, scoped to TMC)

| Key | Value | Sensitive |
|-----|-------|-----------|
| app_name | TMC AI Intelligence | No |
| rag_enabled | true | No |
| pii_enabled | true | No |
| rag_top_k | 7 | No |
| max_tokens | 8192 | No |
| session_hours | 72 | No |

### Running the Seed

```bash
cd server
npx prisma db seed
```

---

## Migration Strategy

### Initial Setup

```bash
# 1. Create database
createdb tmcai

# 2. Set DATABASE_URL in .env
DATABASE_URL="postgresql://user:password@localhost:5432/tmcai"

# 3. Run Prisma migration
cd server
npx prisma migrate dev --name init

# 4. Seed data
npx prisma db seed
```

### Future: pgvector Migration

When pgvector extension is available:

```sql
-- 1. Install extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Prisma schema change: embedding Json -> Unsupported("vector(3072)")
-- 3. Create IVFFlat index
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### Future: Row Level Security

```sql
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY chunks_dept_access ON chunks
  USING (department IS NULL OR department = current_setting('app.user_department', true));
```

---

## Prisma Schema Location

`server/prisma/schema.prisma`

### Prisma Configuration

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Column Naming Convention

Prisma uses camelCase in application code, mapped to snake_case in the database via `@map()`:
- `passwordHash` -> `password_hash`
- `failedAttempts` -> `failed_attempts`
- `lockedUntil` -> `locked_until`
- `isActive` -> `is_active`
- Table names mapped via `@@map()`: `User` -> `users`, `SystemConfig` -> `system_config`, etc.
