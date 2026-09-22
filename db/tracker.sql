CREATE TABLE IF NOT EXISTS pl_inventory (
  sku text PRIMARY KEY, name text NOT NULL,
  on_hand integer NOT NULL CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
  low_stock integer NOT NULL DEFAULT 5 CHECK (low_stock >= 0),
  restocking boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pl_orders (
  id text PRIMARY KEY, request_key text UNIQUE NOT NULL, fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','shipped','cancelled','expired')),
  details jsonb NOT NULL, emails jsonb NOT NULL DEFAULT '{"customer":"pending","owner":"pending"}',
  tracking text, carrier text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pl_orders_recent ON pl_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS pl_orders_expiry ON pl_orders (expires_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS pl_order_items (
  order_id text REFERENCES pl_orders(id), sku text REFERENCES pl_inventory(sku),
  quantity integer NOT NULL CHECK (quantity > 0), PRIMARY KEY(order_id,sku)
);
CREATE TABLE IF NOT EXISTS pl_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  order_id text, sku text, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);

-- Each call is a single transaction. Stock rows are always locked in SKU order.
CREATE OR REPLACE FUNCTION pl_create_order(p_id text, p_key text, p_fingerprint text, p_details jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing pl_orders; item record; inv pl_inventory;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));
  SELECT * INTO existing FROM pl_orders WHERE request_key = p_key;
  IF FOUND THEN
    IF existing.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN to_jsonb(existing) || '{"replayed":true}'::jsonb;
  END IF;
  IF jsonb_typeof(p_items) <> 'object' OR p_items = '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_ITEMS'; END IF;
  INSERT INTO pl_orders(id,request_key,fingerprint,expires_at,details)
    VALUES(p_id,p_key,p_fingerprint,now()+interval '24 hours',p_details);
  FOR item IN SELECT key AS sku, value::integer AS qty FROM jsonb_each_text(p_items) ORDER BY key LOOP
    SELECT * INTO inv FROM pl_inventory WHERE sku = item.sku FOR UPDATE;
    IF NOT FOUND OR item.qty < 1 OR item.qty > inv.on_hand - inv.reserved OR inv.restocking THEN
      RAISE EXCEPTION 'OUT_OF_STOCK';
    END IF;
    UPDATE pl_inventory SET reserved=reserved+item.qty,version=version+1,updated_at=now() WHERE sku=item.sku;
    INSERT INTO pl_order_items VALUES(p_id,item.sku,item.qty);
  END LOOP;
  INSERT INTO pl_events(order_id,action) VALUES(p_id,'order_placed');
  SELECT * INTO existing FROM pl_orders WHERE id=p_id;
  RETURN to_jsonb(existing) || '{"replayed":false}'::jsonb;
END $$;

CREATE OR REPLACE FUNCTION pl_change_order(p_id text, p_status text, p_tracking text DEFAULT NULL, p_carrier text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing pl_orders; item record;
BEGIN
  SELECT * INTO existing FROM pl_orders WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF existing.status=p_status THEN RETURN to_jsonb(existing); END IF;
  IF NOT ((existing.status='pending' AND p_status IN ('paid','cancelled','expired')) OR
          (existing.status='paid' AND p_status IN ('shipped','cancelled'))) THEN
    RAISE EXCEPTION 'INVALID_STATUS_CHANGE';
  END IF;
  IF p_status='shipped' AND (coalesce(length(trim(p_tracking)),0)=0 OR coalesce(length(trim(p_carrier)),0)=0) THEN
    RAISE EXCEPTION 'TRACKING_REQUIRED';
  END IF;
  IF p_status IN ('cancelled','expired','shipped') THEN
    FOR item IN SELECT * FROM pl_order_items WHERE order_id=p_id ORDER BY sku LOOP
      PERFORM 1 FROM pl_inventory WHERE sku=item.sku FOR UPDATE;
      UPDATE pl_inventory SET reserved=reserved-item.quantity,
        on_hand=on_hand-CASE WHEN p_status='shipped' THEN item.quantity ELSE 0 END,
        version=version+1,updated_at=now() WHERE sku=item.sku;
    END LOOP;
  END IF;
  UPDATE pl_orders SET status=p_status,tracking=coalesce(p_tracking,tracking),carrier=coalesce(p_carrier,carrier),updated_at=now() WHERE id=p_id;
  INSERT INTO pl_events(order_id,action,details) VALUES(p_id,'status_changed',jsonb_build_object('from',existing.status,'to',p_status));
  SELECT * INTO existing FROM pl_orders WHERE id=p_id;
  RETURN to_jsonb(existing);
END $$;

CREATE OR REPLACE FUNCTION pl_expire_orders() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; n integer := 0;
BEGIN
  FOR item IN SELECT id FROM pl_orders WHERE status='pending' AND expires_at<now() ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    PERFORM pl_change_order(item.id,'expired'); n := n+1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION pl_adjust_stock(p_sku text,p_count integer,p_low integer,p_restocking boolean,p_version integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE inv pl_inventory;
BEGIN
  SELECT * INTO inv FROM pl_inventory WHERE sku=p_sku FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SKU_NOT_FOUND'; END IF;
  IF inv.version<>p_version THEN RAISE EXCEPTION 'STOCK_CHANGED'; END IF;
  IF p_count<inv.reserved OR p_count<0 OR p_low<0 OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'INVALID_STOCK'; END IF;
  UPDATE pl_inventory SET on_hand=p_count,low_stock=p_low,restocking=p_restocking,version=version+1,updated_at=now() WHERE sku=p_sku;
  INSERT INTO pl_events(sku,action,details) VALUES(p_sku,'stock_adjusted',jsonb_build_object('before',inv.on_hand,'after',p_count,'reason',p_reason));
  SELECT * INTO inv FROM pl_inventory WHERE sku=p_sku;
  RETURN to_jsonb(inv);
END $$;
