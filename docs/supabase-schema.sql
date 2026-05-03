-- GeoDuel Supabase schema.
-- Run this in Supabase SQL Editor after creating a free Supabase project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'GeoDuelist',
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  ranked_wins integer not null default 0,
  ranked_losses integer not null default 0,
  games_played integer not null default 0,
  total_correct integer not null default 0,
  total_wrong integer not null default 0,
  total_skips integer not null default 0,
  current_win_streak integer not null default 0,
  best_win_streak integer not null default 0,
  best_answer_streak integer not null default 0,
  perfect_games integer not null default 0,
  no_skip_wins integer not null default 0,
  achievements jsonb not null default '{}'::jsonb,
  last_rating_delta integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_rating_idx on public.profiles (rating desc, wins desc);
create index if not exists profiles_updated_at_idx on public.profiles (updated_at desc);

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  room_code text not null,
  winner_id uuid references auth.users(id) on delete set null,
  loser_id uuid references auth.users(id) on delete set null,
  mode text not null,
  country_pool text not null,
  ranked boolean not null default false,
  duration_ms integer not null default 0,
  completed_at timestamptz not null default now()
);

create index if not exists matches_completed_at_idx on public.matches (completed_at desc);
create index if not exists matches_country_pool_idx on public.matches (country_pool);
create index if not exists matches_ranked_idx on public.matches (ranked);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event text not null,
  path text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_idx on public.analytics_events (event);
create index if not exists analytics_events_created_at_idx on public.analytics_events (created_at desc);

create table if not exists public.friend_requests (
  id bigint generated always as identity primary key,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_user_id, to_user_id)
);

create index if not exists friend_requests_to_idx on public.friend_requests (to_user_id, status);
create index if not exists friend_requests_from_idx on public.friend_requests (from_user_id, status);

create table if not exists public.friendships (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);

create index if not exists friendships_friend_idx on public.friendships (friend_user_id);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'moderator', 'support')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.role_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create table if not exists public.bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'No reason provided.',
  banned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id);
create index if not exists audit_logs_target_idx on public.audit_logs (target_user_id);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  room_code text,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports (status, created_at desc);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.analytics_events enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.bans enable row level security;
alter table public.audit_logs enable row level security;
alter table public.reports enable row level security;

-- The GeoDuel backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- These read policies are optional niceties for authenticated users.
drop policy if exists "profiles can read leaderboard" on public.profiles;
create policy "profiles can read leaderboard"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "users can read their friend requests" on public.friend_requests;
create policy "users can read their friend requests"
on public.friend_requests for select
to authenticated
using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "users can read their friendships" on public.friendships;
create policy "users can read their friendships"
on public.friendships for select
to authenticated
using (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists "users can create outgoing friend requests" on public.friend_requests;
create policy "users can create outgoing friend requests"
on public.friend_requests for insert
to authenticated
with check (auth.uid() = from_user_id);

drop policy if exists "users can create reports" on public.reports;
create policy "users can create reports"
on public.reports for insert
to authenticated
with check (auth.uid() = reporter_user_id);

-- Roles, permissions, bans, audit logs, analytics, and match writes are handled by the backend
-- with SUPABASE_SERVICE_ROLE_KEY. Do not expose that key to the frontend.
