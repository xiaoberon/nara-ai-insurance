ALTER TABLE evaluation_jobs ADD COLUMN policy TEXT NOT NULL DEFAULT 'v6-coupon-combinations';
--> statement-breakpoint
UPDATE evaluation_jobs SET state='failed', reason='POLICY_UPDATED', lease=NULL WHERE state='running';
