-- Development seed data for South Point. DEV/STAGING ONLY.
-- `supabase db reset` applies this locally; never run it against production.
-- Fixed UUIDs (a000...) make the data easy to reference in tests and easy to
-- identify. Production installs start from an empty catalog.

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
insert into public.categories (id, name, sort_order, default_station) values
  ('a0000000-0000-0000-0000-000000000c01', 'Coffee', 1, 'bar'),
  ('a0000000-0000-0000-0000-000000000c02', 'Non-Coffee', 2, 'bar'),
  ('a0000000-0000-0000-0000-000000000c03', 'Matcha', 3, 'bar'),
  ('a0000000-0000-0000-0000-000000000c04', 'Meals', 4, 'kitchen'),
  ('a0000000-0000-0000-0000-000000000c05', 'Snacks', 5, 'kitchen'),
  ('a0000000-0000-0000-0000-000000000c06', 'Convenience Store', 6, 'none'),
  ('a0000000-0000-0000-0000-000000000c07', 'Pickleball Essentials', 7, 'none');

-- ---------------------------------------------------------------------------
-- Inventory items
-- ---------------------------------------------------------------------------
-- Ingredients
insert into public.inventory_items
  (id, name, sku, inventory_type, category, base_unit, purchase_unit_label,
   purchase_to_base_factor, reorder_level, target_level, track_expiry) values
  ('a0000000-0000-0000-0000-000000001001', 'Coffee Beans (House Blend)', 'ING-BEANS',
   'ingredient', 'Coffee', 'g', '1kg bag', 1000, 2000, 6000, true),
  ('a0000000-0000-0000-0000-000000001002', 'Fresh Milk', 'ING-MILK',
   'ingredient', 'Dairy', 'ml', '1L carton', 1000, 4000, 12000, true),
  ('a0000000-0000-0000-0000-000000001003', 'Oat Milk', 'ING-OAT',
   'ingredient', 'Dairy', 'ml', '1L carton', 1000, 2000, 6000, true),
  ('a0000000-0000-0000-0000-000000001004', 'Condensed Milk', 'ING-COND',
   'ingredient', 'Dairy', 'ml', '380ml can', 380, 1000, 3000, true),
  ('a0000000-0000-0000-0000-000000001005', 'Matcha Powder', 'ING-MATCHA',
   'ingredient', 'Tea', 'g', '100g tin', 100, 200, 500, true),
  ('a0000000-0000-0000-0000-000000001006', 'White Sugar', 'ING-SUGAR',
   'ingredient', 'Dry goods', 'g', '1kg pack', 1000, 1000, 4000, false),
  ('a0000000-0000-0000-0000-000000001007', 'Beef Tapa (marinated)', 'ING-TAPA',
   'ingredient', 'Protein', 'g', '1kg pack', 1000, 1000, 3000, true),
  ('a0000000-0000-0000-0000-000000001008', 'Rice (cooked)', 'ING-RICE',
   'prepared', 'Staples', 'g', 'batch', 1, 1500, 5000, true),
  ('a0000000-0000-0000-0000-000000001009', 'Eggs', 'ING-EGGS',
   'ingredient', 'Protein', 'pc', 'tray of 30', 30, 30, 90, true),
  ('a0000000-0000-0000-0000-000000001010', 'Frozen Fries', 'ING-FRIES',
   'ingredient', 'Frozen', 'g', '1kg bag', 1000, 2000, 6000, true),
-- Packaging
  ('a0000000-0000-0000-0000-000000001011', '12oz Cold Cup', 'PKG-CUP12',
   'packaging', 'Packaging', 'pc', 'sleeve of 50', 50, 100, 400, false),
  ('a0000000-0000-0000-0000-000000001012', 'Cup Lid', 'PKG-LID',
   'packaging', 'Packaging', 'pc', 'sleeve of 50', 50, 100, 400, false),
  ('a0000000-0000-0000-0000-000000001013', 'Paper Straw', 'PKG-STRAW',
   'packaging', 'Packaging', 'pc', 'box of 200', 200, 200, 600, false),
  ('a0000000-0000-0000-0000-000000001014', 'Meal Box', 'PKG-BOX',
   'packaging', 'Packaging', 'pc', 'pack of 25', 25, 50, 150, false),
-- Retail stock
  ('a0000000-0000-0000-0000-000000001015', 'Bottled Water 500ml', 'RTL-WATER',
   'retail', 'Drinks', 'pc', 'case of 24', 24, 24, 72, true),
  ('a0000000-0000-0000-0000-000000001016', 'Cola in Can 330ml', 'RTL-COLA',
   'retail', 'Drinks', 'pc', 'case of 24', 24, 24, 72, true),
  ('a0000000-0000-0000-0000-000000001017', 'Potato Chips 60g', 'RTL-CHIPS',
   'retail', 'Snacks', 'pc', 'box of 10', 10, 10, 40, true),
  ('a0000000-0000-0000-0000-000000001018', 'Pickleball (outdoor)', 'RTL-BALL',
   'retail', 'Pickleball', 'pc', 'pack of 3', 3, 6, 18, false),
  ('a0000000-0000-0000-0000-000000001019', 'Grip Tape', 'RTL-GRIP',
   'retail', 'Pickleball', 'pc', 'pc', 1, 5, 15, false);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
insert into public.products
  (id, kind, name, category_id, price, station, prep_minutes, inventory_item_id) values
  ('a0000000-0000-0000-0000-000000002001', 'prepared', 'Americano',
   'a0000000-0000-0000-0000-000000000c01', 110, 'bar', 4, null),
  ('a0000000-0000-0000-0000-000000002002', 'prepared', 'Café Latte',
   'a0000000-0000-0000-0000-000000000c01', 140, 'bar', 5, null),
  ('a0000000-0000-0000-0000-000000002003', 'prepared', 'Spanish Latte',
   'a0000000-0000-0000-0000-000000000c01', 150, 'bar', 5, null),
  ('a0000000-0000-0000-0000-000000002004', 'prepared', 'Matcha Latte',
   'a0000000-0000-0000-0000-000000000c03', 160, 'bar', 5, null),
  ('a0000000-0000-0000-0000-000000002005', 'prepared', 'Tapsilog',
   'a0000000-0000-0000-0000-000000000c04', 185, 'kitchen', 12, null),
  ('a0000000-0000-0000-0000-000000002006', 'prepared', 'Fries',
   'a0000000-0000-0000-0000-000000000c05', 95, 'kitchen', 8, null),
  ('a0000000-0000-0000-0000-000000002007', 'retail', 'Bottled Water 500ml',
   'a0000000-0000-0000-0000-000000000c06', 25, 'none', 0, 'a0000000-0000-0000-0000-000000001015'),
  ('a0000000-0000-0000-0000-000000002008', 'retail', 'Cola in Can',
   'a0000000-0000-0000-0000-000000000c06', 45, 'none', 0, 'a0000000-0000-0000-0000-000000001016'),
  ('a0000000-0000-0000-0000-000000002009', 'retail', 'Potato Chips',
   'a0000000-0000-0000-0000-000000000c06', 55, 'none', 0, 'a0000000-0000-0000-0000-000000001017'),
  ('a0000000-0000-0000-0000-000000002010', 'retail', 'Pickleball (outdoor)',
   'a0000000-0000-0000-0000-000000000c07', 180, 'none', 0, 'a0000000-0000-0000-0000-000000001018');

-- Hot / Iced variants for espresso drinks
insert into public.product_variants (id, product_id, name, price_delta, is_default, sort_order) values
  ('a0000000-0000-0000-0000-000000003001', 'a0000000-0000-0000-0000-000000002001', 'Hot', 0, true, 1),
  ('a0000000-0000-0000-0000-000000003002', 'a0000000-0000-0000-0000-000000002001', 'Iced', 10, false, 2),
  ('a0000000-0000-0000-0000-000000003003', 'a0000000-0000-0000-0000-000000002002', 'Hot', 0, true, 1),
  ('a0000000-0000-0000-0000-000000003004', 'a0000000-0000-0000-0000-000000002002', 'Iced', 10, false, 2),
  ('a0000000-0000-0000-0000-000000003005', 'a0000000-0000-0000-0000-000000002003', 'Hot', 0, true, 1),
  ('a0000000-0000-0000-0000-000000003006', 'a0000000-0000-0000-0000-000000002003', 'Iced', 10, false, 2),
  ('a0000000-0000-0000-0000-000000003007', 'a0000000-0000-0000-0000-000000002004', 'Iced', 0, true, 1);

-- Recipes (base = all variants; iced adds cup/lid/straw)
insert into public.recipe_ingredients (product_id, variant_id, item_id, qty, waste_pct) values
  -- Spanish Latte: beans 18g, milk 180ml, condensed 20ml (+ iced packaging)
  ('a0000000-0000-0000-0000-000000002003', null, 'a0000000-0000-0000-0000-000000001001', 18, 2),
  ('a0000000-0000-0000-0000-000000002003', null, 'a0000000-0000-0000-0000-000000001002', 180, 0),
  ('a0000000-0000-0000-0000-000000002003', null, 'a0000000-0000-0000-0000-000000001004', 20, 0),
  ('a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000003006', 'a0000000-0000-0000-0000-000000001011', 1, 0),
  ('a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000003006', 'a0000000-0000-0000-0000-000000001012', 1, 0),
  ('a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000003006', 'a0000000-0000-0000-0000-000000001013', 1, 0),
  -- Americano: beans 18g
  ('a0000000-0000-0000-0000-000000002001', null, 'a0000000-0000-0000-0000-000000001001', 18, 2),
  ('a0000000-0000-0000-0000-000000002001', 'a0000000-0000-0000-0000-000000003002', 'a0000000-0000-0000-0000-000000001011', 1, 0),
  ('a0000000-0000-0000-0000-000000002001', 'a0000000-0000-0000-0000-000000003002', 'a0000000-0000-0000-0000-000000001012', 1, 0),
  -- Café Latte: beans 18g, milk 200ml
  ('a0000000-0000-0000-0000-000000002002', null, 'a0000000-0000-0000-0000-000000001001', 18, 2),
  ('a0000000-0000-0000-0000-000000002002', null, 'a0000000-0000-0000-0000-000000001002', 200, 0),
  ('a0000000-0000-0000-0000-000000002002', 'a0000000-0000-0000-0000-000000003004', 'a0000000-0000-0000-0000-000000001011', 1, 0),
  ('a0000000-0000-0000-0000-000000002002', 'a0000000-0000-0000-0000-000000003004', 'a0000000-0000-0000-0000-000000001012', 1, 0),
  ('a0000000-0000-0000-0000-000000002002', 'a0000000-0000-0000-0000-000000003004', 'a0000000-0000-0000-0000-000000001013', 1, 0),
  -- Matcha Latte (iced only): matcha 5g, milk 200ml, sugar 10g + packaging
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001005', 5, 0),
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001002', 200, 0),
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001006', 10, 0),
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001011', 1, 0),
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001012', 1, 0),
  ('a0000000-0000-0000-0000-000000002004', null, 'a0000000-0000-0000-0000-000000001013', 1, 0),
  -- Tapsilog: tapa 150g, rice 200g, 1 egg, meal box
  ('a0000000-0000-0000-0000-000000002005', null, 'a0000000-0000-0000-0000-000000001007', 150, 3),
  ('a0000000-0000-0000-0000-000000002005', null, 'a0000000-0000-0000-0000-000000001008', 200, 0),
  ('a0000000-0000-0000-0000-000000002005', null, 'a0000000-0000-0000-0000-000000001009', 1, 0),
  ('a0000000-0000-0000-0000-000000002005', null, 'a0000000-0000-0000-0000-000000001014', 1, 0),
  -- Fries: 200g fries
  ('a0000000-0000-0000-0000-000000002006', null, 'a0000000-0000-0000-0000-000000001010', 200, 5);

-- ---------------------------------------------------------------------------
-- Modifiers
-- ---------------------------------------------------------------------------
insert into public.modifier_groups (id, name, selection, is_required, min_select, max_select, sort_order) values
  ('a0000000-0000-0000-0000-000000004001', 'Milk Choice', 'single', false, 0, 1, 1),
  ('a0000000-0000-0000-0000-000000004002', 'Extras', 'multi', false, 0, 3, 2),
  ('a0000000-0000-0000-0000-000000004003', 'Sugar Level', 'single', false, 0, 1, 3),
  ('a0000000-0000-0000-0000-000000004004', 'Silog Add-ons', 'multi', false, 0, 2, 4);

insert into public.modifier_options (id, group_id, name, price_delta, sort_order) values
  ('a0000000-0000-0000-0000-000000005001', 'a0000000-0000-0000-0000-000000004001', 'Oat Milk', 30, 1),
  ('a0000000-0000-0000-0000-000000005002', 'a0000000-0000-0000-0000-000000004002', 'Extra Espresso Shot', 40, 1),
  ('a0000000-0000-0000-0000-000000005003', 'a0000000-0000-0000-0000-000000004003', 'Less Sugar', 0, 1),
  ('a0000000-0000-0000-0000-000000005004', 'a0000000-0000-0000-0000-000000004003', 'No Sugar', 0, 2),
  ('a0000000-0000-0000-0000-000000005005', 'a0000000-0000-0000-0000-000000004004', 'Add Egg', 20, 1),
  ('a0000000-0000-0000-0000-000000005006', 'a0000000-0000-0000-0000-000000004004', 'Extra Rice', 25, 2);

insert into public.modifier_option_effects
  (option_id, add_item_id, add_qty, remove_item_id, remove_qty) values
  -- Oat milk replaces fresh milk 1:1 (180ml on the standard latte build)
  ('a0000000-0000-0000-0000-000000005001',
   'a0000000-0000-0000-0000-000000001003', 180,
   'a0000000-0000-0000-0000-000000001002', 180),
  -- Extra shot adds 9g beans
  ('a0000000-0000-0000-0000-000000005002',
   'a0000000-0000-0000-0000-000000001001', 9, null, null),
  -- No sugar removes the matcha sugar
  ('a0000000-0000-0000-0000-000000005004',
   null, null, 'a0000000-0000-0000-0000-000000001006', 10),
  -- Add egg / extra rice
  ('a0000000-0000-0000-0000-000000005005',
   'a0000000-0000-0000-0000-000000001009', 1, null, null),
  ('a0000000-0000-0000-0000-000000005006',
   'a0000000-0000-0000-0000-000000001008', 200, null, null);

insert into public.product_modifier_groups (product_id, group_id, sort_order) values
  ('a0000000-0000-0000-0000-000000002002', 'a0000000-0000-0000-0000-000000004001', 1),
  ('a0000000-0000-0000-0000-000000002002', 'a0000000-0000-0000-0000-000000004002', 2),
  ('a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000004001', 1),
  ('a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000004002', 2),
  ('a0000000-0000-0000-0000-000000002004', 'a0000000-0000-0000-0000-000000004001', 1),
  ('a0000000-0000-0000-0000-000000002004', 'a0000000-0000-0000-0000-000000004003', 2),
  ('a0000000-0000-0000-0000-000000002001', 'a0000000-0000-0000-0000-000000004002', 1),
  ('a0000000-0000-0000-0000-000000002005', 'a0000000-0000-0000-0000-000000004004', 1);

-- ---------------------------------------------------------------------------
-- Opening stock (through the ledger — never direct column writes)
-- ---------------------------------------------------------------------------
select public.add_stock('a0000000-0000-0000-0000-000000001001', 5000, 0.90, 'opening_balance', 'seed', null, (current_date + 90)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001002', 10000, 0.095, 'opening_balance', 'seed', null, (current_date + 10)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001003', 4000, 0.16, 'opening_balance', 'seed', null, (current_date + 30)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001004', 2280, 0.145, 'opening_balance', 'seed', null, (current_date + 180)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001005', 400, 3.50, 'opening_balance', 'seed', null, (current_date + 240)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001006', 3000, 0.065, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001007', 2000, 0.42, 'opening_balance', 'seed', null, (current_date + 5)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001008', 3000, 0.055, 'opening_balance', 'seed', null, (current_date + 1)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001009', 60, 9.00, 'opening_balance', 'seed', null, (current_date + 14)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001010', 4000, 0.19, 'opening_balance', 'seed', null, (current_date + 120)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001011', 300, 4.20, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001012', 300, 2.10, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001013', 500, 0.80, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001014', 100, 6.50, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001015', 48, 12.50, 'opening_balance', 'seed', null, (current_date + 365)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001016', 48, 26.00, 'opening_balance', 'seed', null, (current_date + 365)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001017', 30, 38.00, 'opening_balance', 'seed', null, (current_date + 180)::date, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001018', 12, 110.00, 'opening_balance', 'seed', null, null, null, 'opening stock');
select public.add_stock('a0000000-0000-0000-0000-000000001019', 10, 95.00, 'opening_balance', 'seed', null, null, null, 'opening stock');
