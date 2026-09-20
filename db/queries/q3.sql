-- Login / lookup ignoring email case (seed stores mixed case).
SELECT id, email, role, created_at
FROM users
WHERE lower(email) = 'buyer3000@example.com'
