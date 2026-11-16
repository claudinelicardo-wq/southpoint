-- Undo 0016_loyalty_membership.sql. Run by hand only if stage 1 must be backed out.
-- Not restored: the old raw customers.qr_token values (new random ones are
-- generated), and the previous points_per_peso earn rate (set it in Settings).
begin;

drop function if exists public.loyalty_qr_lookup(text);
drop function if exists public.loyalty_member_set_status(uuid, text, text);
drop function if exists public.loyalty_member_reissue(uuid, text);
drop function if exists public.loyalty_member_register(text, text, text, text, date, boolean);
drop function if exists public.loyalty_expire_customer(uuid);
drop function if exists public.loyalty_points_for_order(uuid);
drop function if exists public.loyalty_token_mint(uuid, text);
drop function if exists public.loyalty_token_hash(text);
drop table if exists public.loyalty_tokens;

drop trigger if exists loyalty_tx_no_update on public.loyalty_transactions;
drop function if exists public.loyalty_tx_immutable();
drop index if exists public.loyalty_tx_idem_key;
alter table public.loyalty_transactions drop column if exists idempotency_key;

drop trigger if exists customers_sync_name on public.customers;
drop function if exists public.customers_sync_name();
drop index if exists public.customers_mobile_unique;
drop index if exists public.customers_member_no_key;
alter table public.customers
  drop column if exists first_name, drop column if exists last_name,
  drop column if exists member_no, drop column if exists member_status,
  drop column if exists marketing_consent, drop column if exists marketing_consent_at,
  add column if not exists qr_token uuid not null default gen_random_uuid() unique;
drop sequence if exists public.member_no_seq;
drop function if exists public.normalize_mobile(text);

update public.settings
   set value = (value - 'earn_points' - 'earn_per_amount' - 'max_points_per_txn'
                - 'eligible_category_ids' - 'eligible_product_ids' - 'excluded_product_ids')
               || jsonb_build_object('points_per_peso', 0.01)
 where key = 'loyalty';

-- Then re-run the loyalty function section of 0009_loyalty.sql (loyalty_post,
-- loyalty_redeem, loyalty_on_order_paid, loyalty_on_refund) to restore the
-- previous engine, and 0015_function_grants.sql to re-lock grants.
commit;
