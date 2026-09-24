-- Twofold: Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query)

create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text default '',
  email text default '',
  phone text default '',
  logo text,
  username text not null unique,
  password text not null,
  quote_counter integer not null default 1,
  invoice_counter integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  type text not null check (type in ('quote','invoice')),
  number text not null,
  status text not null default 'draft',
  client_name text not null,
  client_address text default '',
  client_email text default '',
  issue_date date not null,
  due_date date,
  items jsonb not null default '[]',
  tax_rate numeric not null default 0,
  notes text default '',
  terms text default '',
  converted_from_id uuid references documents(id),
  created_at timestamptz not null default now()
);

alter table companies enable row level security;
alter table documents enable row level security;

-- IMPORTANT SECURITY NOTE
-- This app does its own simple username/password check in the browser rather
-- than using Supabase Auth. That means the anon API key (which is public,
-- baked into the deployed site) needs permission to read/write these tables
-- directly. The policies below grant that.
--
-- Practical effect: the login screen stops casual/accidental cross-access
-- between the two companies, but it is NOT true security. Anyone who
-- extracts your anon key from the deployed site's network requests could
-- query these tables directly, bypassing the login screen entirely.
-- Don't store sensitive data (bank account numbers, ID numbers, etc.) in
-- here. If you outgrow this later, migrating to Supabase Auth is the fix.

create policy "public read companies" on companies for select using (true);
create policy "public insert companies" on companies for insert with check (true);
create policy "public update companies" on companies for update using (true);

create policy "public read documents" on documents for select using (true);
create policy "public insert documents" on documents for insert with check (true);
create policy "public update documents" on documents for update using (true);
create policy "public delete documents" on documents for delete using (true);

-- Supabase now defaults new projects to NOT exposing new tables to the
-- Data API (the REST layer supabase-js talks to) unless explicitly granted.
-- These grants make sure the app can actually reach the tables above.
-- (Harmless to run even if your project still uses the older default.)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on companies to anon, authenticated;
grant select, insert, update, delete on documents to anon, authenticated;

-- ---------------------------------------------------------------------
-- MIGRATION (run this block if you already created the tables earlier)
-- Adds: a company-level banking details field, and a per-document
-- toggle for whether tax applies at all. Safe to run multiple times.
-- ---------------------------------------------------------------------
alter table companies add column if not exists bank_details text default '';
alter table documents add column if not exists tax_enabled boolean not null default true;

-- Structured banking detail fields (replaces the single bank_details textbox
-- with separate labeled fields, matching a typical SA invoice layout).
alter table companies add column if not exists bank_account_holder text default '';
alter table companies add column if not exists bank_name text default '';
alter table companies add column if not exists bank_account_type text default '';
alter table companies add column if not exists bank_branch_code text default '';
alter table companies add column if not exists bank_account_number text default '';

-- ---------------------------------------------------------------------
-- MIGRATION: Job card system
-- Technicians get their own login, scoped to one company, and can only
-- reach job cards — never the quotes/invoices screens (that's enforced
-- in the app's code, not the database, same as the rest of this app's
-- login model).
-- ---------------------------------------------------------------------
create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  username text not null unique,
  password text not null,
  created_at timestamptz not null default now()
);

create table if not exists job_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  technician_id uuid references technicians(id) on delete set null,
  technician_name text default '',
  client_name text not null,
  site_address text default '',
  description text default '',
  status text not null default 'open', -- open, quoted, invoiced, closed
  spares_needed jsonb not null default '[]',
  spares_used jsonb not null default '[]',
  photos jsonb not null default '[]',
  quote_id uuid references documents(id) on delete set null,
  invoice_id uuid references documents(id) on delete set null,
  notes text default '',
  created_at timestamptz not null default now()
);

alter table technicians enable row level security;
alter table job_cards enable row level security;

create policy "public read technicians" on technicians for select using (true);
create policy "public insert technicians" on technicians for insert with check (true);
create policy "public update technicians" on technicians for update using (true);
create policy "public delete technicians" on technicians for delete using (true);

create policy "public read job_cards" on job_cards for select using (true);
create policy "public insert job_cards" on job_cards for insert with check (true);
create policy "public update job_cards" on job_cards for update using (true);
create policy "public delete job_cards" on job_cards for delete using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on technicians to anon, authenticated;
grant select, insert, update, delete on job_cards to anon, authenticated;

-- Storage bucket for job card photos (public read, so photos display
-- directly by URL; anyone with the anon key can upload/read, matching
-- this app's existing "simple, not bulletproof" security model).
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', true)
on conflict (id) do nothing;

create policy "public upload job photos" on storage.objects
  for insert with check (bucket_id = 'job-photos');
create policy "public read job photos" on storage.objects
  for select using (bucket_id = 'job-photos');
create policy "public delete job photos" on storage.objects
  for delete using (bucket_id = 'job-photos');

-- ---------------------------------------------------------------------
-- MIGRATION: Receipts for spares bought (admin only in the app)
-- Stores scanned receipt files (in the job-photos bucket, under a
-- receipts/ subfolder) against each job card. Safe to run multiple times.
-- ---------------------------------------------------------------------
alter table job_cards add column if not exists receipts jsonb not null default '[]';
