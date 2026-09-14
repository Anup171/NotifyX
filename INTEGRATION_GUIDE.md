# NotifyX Integration Guide

> Comprehensive developer guide for integrating with the **NotifyX** real-time notification platform.

---

## 1. Overview & Architecture

NotifyX provides high-throughput, low-latency notification delivery via HTTP REST endpoints and persistent WebSockets (Socket.io).

```text
+-----------------------+              +-----------------------------------------+              +-----------------------+
|  Your Backend Service |              |          NotifyX API Server             |              |  Client Web / Mobile  |
+-----------------------+              +-----------------------------------------+              +-----------------------+
            |                                       |                                                       |
            |-- 1. POST /api/notify --------------->|                                                       |
            |   (ApiKey or Bearer JWT)              |-- 2. Validate & Redis SET NX (Idempotency)            |
            |                                       |-- 3. Return HTTP 202 Accepted                         |
            |<-- 202 { status: "accepted" } --------|                                                       |
            |                                       |-- 4. setImmediate(dispatch)                           |
            |                                       |      - Check recipient preferences & quiet hours      |
            |                                       |      - Save to MongoDB (Notification.create)          |
            |                                       |      - Check socket presence in memory                |
            |                                       |                                                       |
            |                                       |-- 5. io.to(recipientId).emit("notification") -------->|
            |                                       |      (Real-time live WebSocket push <50ms)            |
            |                                       |                                                       |
```

### Environment Base URLs

| Environment | API Base URL | WebSocket URL | Dashboard URL |
| :--- | :--- | :--- | :--- |
| **Local Development** | `http://localhost:3000` | `http://localhost:3000` | `http://localhost:8080/dashboard.html` |
| **Cloud Production** | `https://notifyx-api-fln6.onrender.com` | `https://notifyx-api-fln6.onrender.com` | `https://notifyx-sumit.vercel.app/dashboard.html` |

---

## 2. Authentication Methods

NotifyX supports three authentication mechanisms depending on the integration context:

### A. API Key Authentication (`ApiKey nx_...`)
Best for **server-to-server** communication and backend microservices sending notifications.
- Header: `Authorization: ApiKey nx_your_api_key_here`
- Keys are SHA-256 hashed on the server; the raw key is displayed only once upon generation.

### B. User JWT Authentication (`Bearer <token>`)
Best for **browser / mobile client sessions**, fetching inboxes, toggling preferences, and self-service key management.
- Header: `Authorization: Bearer <your_jwt_token>`
- Token obtained via `POST /api/auth/login` or `POST /api/auth/signup`.
- Valid for 7 days.

### C. Admin Secret Header (`x-admin-secret`)
Used for administrative routes (e.g., admin API key provisioning).
- Header: `x-admin-secret: <your_admin_secret>`

---

## 3. User Authentication Endpoints

### 1. User Signup
Create a new user account.

```http
POST /api/auth/signup
Content-Type: application/json

{
  "userId": "user_alice",
  "password": "securePassword123"
}
```

**Response (`201 Created`):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "user_alice",
  "expiresIn": "7d"
}
```

### 2. User Login
Authenticate an existing user.

```http
POST /api/auth/login
Content-Type: application/json

{
  "userId": "user_alice",
  "password": "securePassword123"
}
```

**Response (`200 OK`):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "user_alice",
  "expiresIn": "7d"
}
```

---

## 4. Dispatching Notifications

### `POST /api/notify`

Dispatches a notification to a recipient. The API validates the payload, verifies idempotency, returns `202 Accepted` immediately, and dispatches asynchronously in-process via `setImmediate`.

#### Request Headers
```http
Content-Type: application/json
Authorization: ApiKey nx_live_xxxxxxxxxxxxxxxxxxxxxxxx
# OR: Authorization: Bearer <jwt_token>
```

#### Request Payload Schema

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `recipientId` | `string` | **Yes** | Target user identifier (3–64 chars). |
| `senderId` | `string` | **Yes** | Identifier of the sender app or user. |
| `type` | `string` | **Yes** | One of: `"like"`, `"comment"`, `"follow"`, `"mention"`, `"system"`. |
| `payload` | `object` | **Yes** | Object containing `message` (required, 1–1000 chars) and optional metadata (e.g., `link`). |
| `idempotencyKey`| `string` | No | Unique UUID to guarantee exactly-once processing (24h Redis window). |
| `priority` | `number` | No | Optional integer from `1` (lowest) to `10` (highest). Default: `5`. |

#### Example Request Body
```json
{
  "recipientId": "user_alice",
  "senderId": "payments-service",
  "type": "system",
  "payload": {
    "message": "Your payout of $250.00 has been processed.",
    "link": "/billing/invoices/inv_9981"
  },
  "idempotencyKey": "d8e3b4a2-11c9-4b68-9a3b-28f0e527b14d",
  "priority": 8
}
```

#### Response
- **`202 Accepted`**:
  ```json
  {
    "status": "accepted"
  }
  ```
- **`409 Conflict`** (Duplicate `idempotencyKey` sent within 24h):
  ```json
  {
    "error": "Duplicate notification request"
  }
  ```

---

## 5. Code Examples

### Node.js / TypeScript (Backend Dispatch)

```typescript
import crypto from 'crypto';

interface NotificationPayload {
  recipientId: string;
  senderId: string;
  type: 'like' | 'comment' | 'follow' | 'mention' | 'system';
  message: string;
  link?: string;
  priority?: number;
}

async function sendNotification({
  recipientId,
  senderId,
  type,
  message,
  link,
  priority = 5,
}: NotificationPayload) {
  const API_BASE = process.env.NOTIFYX_API_URL || 'https://notifyx-api-fln6.onrender.com';
  const API_KEY = process.env.NOTIFYX_API_KEY!;

  const response = await fetch(`${API_BASE}/api/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${API_KEY}`,
    },
    body: JSON.stringify({
      recipientId,
      senderId,
      type,
      payload: { message, link },
      idempotencyKey: crypto.randomUUID(),
      priority,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(`NotifyX error [${response.status}]: ${JSON.stringify(errorBody)}`);
  }

  return response.json(); // { status: "accepted" }
}

// Example usage:
await sendNotification({
  recipientId: 'user_alice',
  senderId: 'blog-app',
  type: 'comment',
  message: 'Bob commented on your article.',
  link: '/posts/hello-world#comment-42',
});
```

---

### Python (Backend Dispatch)

```python
import uuid
import requests

NOTIFYX_API_URL = "https://notifyx-api-fln6.onrender.com"
NOTIFYX_API_KEY = "nx_your_api_key_here"

def dispatch_notification(recipient_id: str, sender_id: str, notif_type: str, message: str, link: str = None):
    url = f"{NOTIFYX_API_URL}/api/notify"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"ApiKey {NOTIFYX_API_KEY}",
    }
    payload = {
        "recipientId": recipient_id,
        "senderId": sender_id,
        "type": notif_type,
        "payload": {
            "message": message,
            "link": link
        },
        "idempotencyKey": str(uuid.uuid4()),
        "priority": 5
    }

    response = requests.post(url, json=payload, headers=headers, timeout=5)
    response.raise_for_status()
    return response.json()

# Example usage:
dispatch_notification(
    recipient_id="user_alice",
    sender_id="auth-service",
    notif_type="system",
    message="New login detected from Chrome on macOS.",
    link="/security/audit"
)
```

---

### cURL

```bash
curl -X POST https://notifyx-api-fln6.onrender.com/api/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey nx_live_your_key_here" \
  -d '{
    "recipientId": "user_alice",
    "senderId": "deploy-bot",
    "type": "system",
    "payload": {
      "message": "Deployment v2.4.0 successfully deployed to production.",
      "link": "/deploys/v2.4.0"
    },
    "idempotencyKey": "a918f45a-c4d3-48e0-bb12-4f3879a9e26e"
  }'
```

---

## 6. Real-time WebSockets (Socket.io Client)

NotifyX pushes notifications in sub-50ms directly to connected browser/mobile clients via Socket.io.

### Client Connection & Event Handling

```javascript
import { io } from 'socket.io-client';

const API_BASE = 'https://notifyx-api-fln6.onrender.com';
const token = localStorage.getItem('notifyx_jwt_token');

// 1. Initialize Socket.io connection with JWT authentication
const socket = io(API_BASE, {
  auth: { token },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

// 2. Lifecycle Events
socket.on('connect', () => {
  console.log('[NotifyX] Connected to real-time channel. ID:', socket.id);
  // Offline sync is automatically triggered on reconnect by the server
});

socket.on('connect_error', (error) => {
  console.warn('[NotifyX] Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('[NotifyX] Disconnected:', reason);
});

// 3. Listen for incoming notifications
socket.on('notification', (notif) => {
  console.log('[NotifyX] New notification received:', notif);
  /*
    notif shape:
    {
      "_id": "664b38e12d3...",
      "recipientId": "user_alice",
      "senderId": "blog-app",
      "type": "comment",
      "payload": {
        "message": "Bob commented on your article.",
        "link": "/posts/hello-world#comment-42"
      },
      "delivered": true,
      "read": false,
      "createdAt": "2026-09-14T18:30:00.000Z"
    }
  */
  displayToastNotification(notif.payload.message);
  incrementUnreadBadge();
});
```

---

## 7. Managing Inbox & Notifications API

All inbox endpoints require a valid User JWT (`Bearer <jwt_token>`).

### 1. Get Notification Inbox (Paginated)
```http
GET /api/notifications?page=1&limit=20&type=comment
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "notifications": [
    {
      "_id": "664b38e12d3...",
      "recipientId": "user_alice",
      "senderId": "blog-app",
      "type": "comment",
      "payload": {
        "message": "Bob commented on your post."
      },
      "read": false,
      "delivered": true,
      "createdAt": "2026-09-14T18:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

### 2. Get Unread Count (Redis Cached)
```http
GET /api/notifications/unread-count
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "count": 4
}
```

### 3. Mark Single Notification as Read
```http
PATCH /api/notifications/664b38e12d3.../read
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "notification": {
    "_id": "664b38e12d3...",
    "read": true
  }
}
```

### 4. Bulk Mark All as Read
```http
PATCH /api/notifications/mark-all-read
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "updatedCount": 4
}
```

---

## 8. User Preferences & Quiet Hours

Users can configure delivery channels, mute specific types, and schedule quiet hours.

### 1. Fetch Current Preferences
```http
GET /api/users/preferences
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "userId": "user_alice",
  "inApp": true,
  "mutedTypes": ["like"],
  "quietHours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00"
  }
}
```

### 2. Update Preferences
```http
PUT /api/users/preferences
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "inApp": true,
  "mutedTypes": ["like", "follow"],
  "quietHours": {
    "enabled": true,
    "start": "23:00",
    "end": "07:00"
  }
}
```

---

## 9. API Keys Management

Developers can generate and manage per-app API keys self-service.

### 1. Generate a New API Key
```http
POST /api/keys/self
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "appName": "Production E-Commerce Backend"
}
```

**Response (`201 Created`):**
```json
{
  "key": "nx_live_9f838e12d3ac4178...",
  "prefix": "nx_live_9f83",
  "appName": "Production E-Commerce Backend",
  "createdAt": "2026-09-14T18:00:00.000Z",
  "note": "Save this key now — it will not be shown again."
}
```

### 2. List Your Active API Keys
```http
GET /api/keys/self
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
[
  {
    "_id": "664b38e12d3...",
    "prefix": "nx_live_9f83",
    "appName": "Production E-Commerce Backend",
    "createdAt": "2026-09-14T18:00:00.000Z"
  }
]
```

### 3. Revoke an API Key
```http
DELETE /api/keys/self/664b38e12d3...
Authorization: Bearer <jwt_token>
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "message": "API key revoked"
}
```

---

## 10. Social & Productivity Integrations

NotifyX supports external channel sync for GitHub, Gmail, LinkedIn, and WhatsApp via polling and webhooks.

- **Toggle Integration:** `POST /api/users/integrations/toggle` (Body: `{ "provider": "github", "connected": true, "credentials": { ... } }`)
- **Integration Status:** `GET /api/users/integrations`
- **Webhook Ingress:** `POST /api/integrations/webhooks/:provider`

---

## 11. Health & Metrics

| Endpoint | Method | Auth | Description |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | None | Database readiness check (`{ "status": "ok", "uptime": 1420 }`). |
| `/api/metrics` | `GET` | Optional | Running delivery counters (total, success, failed, successRate). |
| `/api/metrics/series` | `GET` | Optional | Time-series delivery stats (`?range=1h\|24h\|7d\|30d`). |

---

## 12. HTTP Status & Error Codes

| Status Code | Reason | Description |
| :--- | :--- | :--- |
| `200 OK` | Success | Request succeeded and returned data. |
| `201 Created` | Resource Created | Account or API key successfully created. |
| `202 Accepted` | Async Dispatched | Notification payload passed validation & queued for in-process dispatch. |
| `400 Bad Request` | Validation Error | Payload failed schema validation (e.g. missing `message` or invalid `type`). |
| `401 Unauthorized` | Auth Required | Missing or expired JWT token / invalid API key. |
| `403 Forbidden` | Access Denied | Invalid admin secret or insufficient permissions. |
| `409 Conflict` | Idempotency Dupe | An identical `idempotencyKey` was already accepted within 24 hours. |
| `429 Too Many Requests` | Rate Limited | Exceeded rate limit (50 req/min per recipient or 10,000 req/min global). |
| `500 Server Error` | Internal Error | Unexpected server failure. |
