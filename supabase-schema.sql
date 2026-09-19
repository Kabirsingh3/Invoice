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
