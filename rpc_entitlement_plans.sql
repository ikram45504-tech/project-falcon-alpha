-- Entitlement plan catalog + companies.plan_id
-- Applied live via migration entitlement_plans_catalog.
-- Changing a company tier updates one companies row only.
-- Bookings, payments, parties, and users are never rewritten.

-- public.entitlement_plans (free, pro, enterprise locked floors; custom open)
-- public.companies.plan_id  -> entitlement_plans.id
-- public.master_assign_company_plan(p_company_id, p_plan_id)
-- public.master_set_company_entitlements still writes capacity JSON and syncs plan_id
