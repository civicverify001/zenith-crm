-- ============================================================
-- MIGRATION 001: Users, Roles, Auth Foundation
-- Zenith Pure Solutions CRM
-- Run: supabase db push
-- ============================================================

-- ── Enable UUID extension ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'admin',
  'frontdesk',
  'salesrep',
  'technician'
);

CREATE TYPE lead_stage AS ENUM (
  'new_lead',
  'qualifying',
  'qualified',
  'site_visit_scheduled',
  'proposal_in_progress',
  'quote_sent',
  'agreement_signed',
  'won',
  'lost',
  'future_follow_up',
  'dnd'
);

CREATE TYPE job_stage AS ENUM (
  'scheduled',
  'waiting_for_stock',
  'in_progress',
  'complete'
);

CREATE TYPE customer_stage AS ENUM (
  'active',
  'service_due',
  'renewal_due',
  'upsell',
  'at_risk'
);

CREATE TYPE invoice_type AS ENUM (
  'deposit',
  'final',
  'commission',
  'rental',
  'maintenance',
  'filter_sale'
);

CREATE TYPE invoice_status AS ENUM (
  'pending',
  'paid',
  'failed',
  'overdue'
);

CREATE TYPE payment_method AS ENUM (
  'cash',
  'card',
  'ach',
  'hearth_finance'
);

CREATE TYPE water_source AS ENUM (
  'municipal',
  'well',
  'spring'
);

CREATE TYPE quote_type AS ENUM (
  'purchase',
  'rental'
);

CREATE TYPE lead_source AS ENUM (
  'website_form',
  'phone_call',
  'email',
  'walk_in',
  'referral_realtor',
  'referral_partner',
  'google_ad',
  'meta_ad',
  'trade_show',
  'event'
);

CREATE TYPE water_concern AS ENUM (
  'hard_water',
  'iron_rust',
  'sulfur_odor',
  'taste_chlorine',
  'pfas_chemicals',
  'lead_heavy_metals',
  'well_water',
  'general_filtration',
  'unknown'
);

CREATE TYPE follow_up_task_type AS ENUM (
  'deposit_follow_up',
  'quote_follow_up',
  'payment_failure_followup',
  'google_review_request',
  're_engage',
  'service_due_reminder',
  'rental_renewal',
  'filter_replacement',
  'general'
);

CREATE TYPE activity_event AS ENUM (
  'lead_created',
  'lead_stage_changed',
  'call_attempt_logged',
  'appointment_scheduled',
  'water_test_recorded',
  'quote_created',
  'quote_sent',
  'quote_opened',
  'agreement_signed',
  'job_created',
  'job_stage_changed',
  'checklist_item_completed',
  'handover_signed',
  'install_completed',
  'customer_created',
  'invoice_created',
  'payment_succeeded',
  'payment_failed',
  'follow_up_task_created',
  'follow_up_task_completed',
  'service_due_triggered',
  'renewal_due_triggered',
  'automation_error'
);

-- ── user_profiles ─────────────────────────────────────────────
-- Extends Supabase auth.users with CRM-specific profile data
CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'frontdesk',
  phone         TEXT,
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on new auth user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'frontdesk')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS: user_profiles ────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "admins_read_all_profiles"
  ON user_profiles FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role = 'admin'
    )
  );

-- Users can update their own non-role fields
CREATE POLICY "users_update_own_profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    -- Cannot change own role — only admin can change roles
    role = (SELECT role FROM user_profiles WHERE id = auth.uid())
  );

-- Only admins can update roles
CREATE POLICY "admins_update_any_profile"
  ON user_profiles FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM user_profiles WHERE role = 'admin'
    )
  );

-- ── Seed: Create Kuldeep as admin ─────────────────────────────
-- NOTE: Run this AFTER creating Kuldeep's account via Supabase Auth
-- Or insert manually in Supabase dashboard after signup:
-- UPDATE user_profiles SET role = 'admin', full_name = 'Kuldeep' WHERE id = '<your-user-id>';

COMMENT ON TABLE user_profiles IS
  'CRM user profiles extending Supabase auth.users. Role controls all RLS policies.';
