# Auth Testing Playbook

This file is referenced when testing the Emergent Google Auth flow for The Collective Savers.

## Step 1: Create Test User & Session via Mongo

```bash
mongosh "$MONGO_URL" --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://i.pravatar.cc/150',
  role: 'consumer',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: API tests (Bearer fallback)

```bash
API=$REACT_APP_BACKEND_URL
curl -s -X GET "$API/api/auth/me" -H "Authorization: Bearer $TOKEN"
curl -s -X GET "$API/api/vpps"
curl -s -X POST "$API/api/vpps/<vpp_id>/join" -H "Authorization: Bearer $TOKEN"
curl -s -X GET "$API/api/me/parties" -H "Authorization: Bearer $TOKEN"
```

## Step 3: Browser cookie injection

```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "<TOKEN>",
    "domain": "<APP_DOMAIN>",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
```

## Role escalation for testing supplier/admin

```bash
curl -s -X POST "$API/api/auth/role" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```
