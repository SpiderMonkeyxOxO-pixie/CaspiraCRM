-- Order status vocabulary now matches the frontend (ORDER_STATUSES):
-- "Pending Confirmation" is called "Pending Review".
UPDATE "orders" SET "status" = 'Pending Review' WHERE "status" = 'Pending Confirmation';
UPDATE "orders" SET "statusBeforeArchive" = 'Pending Review' WHERE "statusBeforeArchive" = 'Pending Confirmation';
