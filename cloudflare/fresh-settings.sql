-- Only apply to the new empty database; never reset the existing Sites DB.
-- Owners stay inactive until the new site and bot have passed acceptance.
INSERT INTO settings(key,value) VALUES('pipeline_bootstrapped_v3','true');
INSERT INTO settings(key,value) VALUES('seeded','true');
INSERT INTO settings(key,value) VALUES('retention_enabled','true');
INSERT INTO settings(key,value) VALUES('scheduler_owner_daily','"legacy"');
INSERT INTO settings(key,value) VALUES('scheduler_owner_episodes','"legacy"');
