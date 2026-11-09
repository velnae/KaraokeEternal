-- Up
INSERT INTO roles (name) VALUES ('operator'), ('manager');

-- Down
UPDATE users SET roleId = (SELECT roleId FROM roles WHERE name = 'standard')
WHERE roleId IN (SELECT roleId FROM roles WHERE name IN ('operator', 'manager'));
DELETE FROM roles WHERE name IN ('operator', 'manager');
