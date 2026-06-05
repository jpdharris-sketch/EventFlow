/*
 * ── Supabase SQL Migration ───────────────────────────────────
 * Run the following once in your Supabase project's SQL Editor
 * (Database → SQL Editor → New query) before first use.
 *
 * -- Tables
 * create table if not exists public.events (
 *   id         uuid primary key default gen_random_uuid(),
 *   owner_id    uuid references auth.users on delete cascade not null,
 *   name       text not null default 'Untitled Event',
 *   date       date,
 *   type       text,
 *   created_at timestamptz default now() not null
 * );
 *
 * create table if not exists public.sessions (
 *   id         uuid primary key default gen_random_uuid(),
 *   event_id   uuid references public.events on delete cascade not null,
 *   title      text not null,
 *   start_time text not null,
 *   duration   integer not null default 60,
 *   location   text not null default '',
 *   notes      jsonb not null default '{}',
 *   created_at timestamptz default now() not null
 * );
 *
 * create table if not exists public.event_shares (
 *   id                uuid primary key default gen_random_uuid(),
 *   event_id          uuid references public.events on delete cascade not null,
 *   shared_with_email text not null,
 *   permission        text not null default 'view'
 *                       check (permission in ('view','edit')),
 *   created_by        uuid references auth.users on delete cascade not null,
 *   created_at        timestamptz default now() not null,
 *   unique (event_id, shared_with_email)
 * );
 *
 * -- Row-Level Security
 * alter table public.events       enable row level security;
 * alter table public.sessions     enable row level security;
 * alter table public.event_shares enable row level security;
 *
 * -- Events: owner has full access
 * create policy "events_owner" on public.events for all
 *   using  (auth.uid() = owner_id)
 *   with check (auth.uid() = owner_id);
 *
 * -- Events: shared users can read
 * create policy "events_shared_read" on public.events for select
 *   using (id in (
 *     select event_id from public.event_shares
 *     where shared_with_email = auth.jwt() ->> 'email'
 *   ));
 *
 * -- Sessions: readable if the parent event is accessible to the user
 * create policy "sessions_read" on public.sessions for select
 *   using (event_id in (select id from public.events));
 *
 * -- Sessions: writable by event owner or editor
 * create policy "sessions_insert" on public.sessions for insert
 *   with check (
 *     event_id in (select id from public.events where owner_id = auth.uid())
 *     or event_id in (
 *       select event_id from public.event_shares
 *       where shared_with_email = auth.jwt() ->> 'email' and permission = 'edit'
 *     )
 *   );
 * create policy "sessions_update" on public.sessions for update
 *   using (
 *     event_id in (select id from public.events where owner_id = auth.uid())
 *     or event_id in (
 *       select event_id from public.event_shares
 *       where shared_with_email = auth.jwt() ->> 'email' and permission = 'edit'
 *     )
 *   );
 * create policy "sessions_delete" on public.sessions for delete
 *   using (
 *     event_id in (select id from public.events where owner_id = auth.uid())
 *     or event_id in (
 *       select event_id from public.event_shares
 *       where shared_with_email = auth.jwt() ->> 'email' and permission = 'edit'
 *     )
 *   );
 *
 * -- Event shares: owner can manage all shares for their events
 * create policy "shares_owner" on public.event_shares for all
 *   using  (event_id in (select id from public.events where owner_id = auth.uid()))
 *   with check (event_id in (select id from public.events where owner_id = auth.uid()));
 *
 * -- Event shares: recipients can read their own share entries
 * create policy "shares_recipient_read" on public.event_shares for select
 *   using (shared_with_email = auth.jwt() ->> 'email');
 *
 * -- Google OAuth: in Supabase dashboard → Authentication → Providers → Google,
 *    enable Google and add your OAuth client ID + secret. Then in
 *    Authentication → URL Configuration add your site URL to "Redirect URLs":
 *      https://yourname.github.io/EventFlow/
 *    and http://localhost (for local development).
 */

const SUPABASE_URL  = 'https://itzwzxrftnbsflykymiy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0end6eHJmdG5ic2ZseWt5bWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NDgzMTQsImV4cCI6MjA5NjEyNDMxNH0.PHiFDMLBmJDfAMPkvXzkPwcsrOQo3eFsD2kbtJUrprY';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
