/**
 * Signaling Server for WebRTC P2P Connections
 * Fixed: user discovery, online status broadcast, presence sync
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Store connected users
const users = new Map(); // publicKey -> { ws, username, lastSeen }
const pendingSignals = new Map(); // targetPublicKey -> [signals]

// Shared DHT store — key/value pairs shared across all clients
// Used for pre-key bundles and message queues
const dhtStore = new Map(); // keyHex -> { value: Buffer, timestamp: number }

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      users: users.size,
      uptime: process.uptime(),
      userList: Array.from(users.keys()).map(k => k.substring(0, 8) + '...')
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocket.Server({ server });

console.log(`Signaling server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
  let userPublicKey = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (error) {
      console.error('Error parsing message:', error);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    if (userPublicKey) {
      console.log(`User disconnected: ${userPublicKey.substring(0, 8)}... (${users.size - 1} remaining)`);
      users.delete(userPublicKey);
      broadcast({ type: 'user-offline', publicKey: userPublicKey }, userPublicKey);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  function handleMessage(ws, message) {
    switch (message.type) {
      case 'register': handleRegister(ws, message); break;
      case 'find-user': handleFindUser(ws, message); break;
      case 'list-users': handleListUsers(ws); break;
      case 'signal': handleSignal(ws, message); break;
      case 'chat-message': handleChatMessage(ws, message); break;
      case 'dht-put': handleDhtPut(ws, message); break;
      case 'dht-get': handleDhtGet(ws, message); break;
      case 'ping': ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() })); break;
      case 'pong':
        // Client responded to our heartbeat — update lastSeen
        if (userPublicKey && users.has(userPublicKey)) {
          users.get(userPublicKey).lastSeen = Date.now();
        }
        break;
      default: sendError(ws, `Unknown message type: ${message.type}`);
    }
  }

  function handleRegister(ws, message) {
    const { publicKey, username, lastSeen } = message;
    if (!publicKey) { sendError(ws, 'Public key is required'); return; }

    userPublicKey = publicKey;
    users.set(publicKey, {
      ws,
      username: username || 'Anonymous',
      lastSeen: lastSeen || Date.now()
    });

    console.log(`✅ Registered: ${username} (${publicKey.substring(0, 8)}...) — ${users.size} online`);

    // 1. Confirm registration
    ws.send(JSON.stringify({ type: 'registered', publicKey, timestamp: Date.now() }));

    // 2. Send the FULL list of currently online users to the new user
    //    This is the key fix: new user immediately knows who is already online
    const onlineUsers = Array.from(users.entries())
      .filter(([pk]) => pk !== publicKey)
      .map(([pk, u]) => ({ publicKey: pk, username: u.username, lastSeen: u.lastSeen }));

    if (onlineUsers.length > 0) {
      ws.send(JSON.stringify({
        type: 'user-list',
        users: onlineUsers,
        count: onlineUsers.length
      }));
      console.log(`  → Sent ${onlineUsers.length} existing users to new registrant`);
    }

    // 3. Notify ALL other users that this user is now online
    broadcast({ type: 'user-online', publicKey, username, lastSeen: lastSeen || Date.now() }, publicKey);

    // 4. Deliver any pending signals
    if (pendingSignals.has(publicKey)) {
      const signals = pendingSignals.get(publicKey);
      console.log(`  → Delivering ${signals.length} pending signal(s)`);
      signals.forEach(signal => ws.send(JSON.stringify(signal)));
      pendingSignals.delete(publicKey);
    }
  }

  function handleFindUser(ws, message) {
    const { publicKey } = message;
    if (!publicKey) { sendError(ws, 'Public key is required'); return; }

    const user = users.get(publicKey);
    ws.send(JSON.stringify({
      type: 'user-found',
      publicKey,
      online: !!user,
      username: user ? user.username : null,
      lastSeen: user ? user.lastSeen : null
    }));
  }

  function handleListUsers(ws) {
    const userList = Array.from(users.entries()).map(([publicKey, user]) => ({
      publicKey,
      username: user.username,
      lastSeen: user.lastSeen
    }));
    ws.send(JSON.stringify({ type: 'user-list', users: userList, count: userList.length }));
  }

  function handleSignal(ws, message) {
    const { to, from, signal } = message;
    if (!to || !from || !signal) { sendError(ws, 'Invalid signal message'); return; }

    const targetUser = users.get(to);
    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(JSON.stringify({ type: 'signal', from, signal }));
    } else {
      if (!pendingSignals.has(to)) pendingSignals.set(to, []);
      pendingSignals.get(to).push({ type: 'signal', from, signal, timestamp: Date.now() });
    }
  }

  function handleChatMessage(ws, message) {
    const { to, from, content, messageId, timestamp } = message;
    if (!to || !from || !content) { sendError(ws, 'Invalid chat-message'); return; }

    const targetUser = users.get(to);
    const payload = JSON.stringify({ type: 'chat-message', from, content, messageId, timestamp });

    if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
      targetUser.ws.send(payload);
      // Ack to sender
      ws.send(JSON.stringify({ type: 'chat-message-ack', messageId, delivered: true }));
    } else {
      // Queue for offline delivery (reuse pendingSignals)
      if (!pendingSignals.has(to)) pendingSignals.set(to, []);
      pendingSignals.get(to).push({ type: 'chat-message', from, content, messageId, timestamp, timestamp: Date.now() });
      ws.send(JSON.stringify({ type: 'chat-message-ack', messageId, delivered: false, queued: true }));
    }
  }

  function handleDhtPut(ws, message) {
    const { key, value } = message;
    if (!key || value === undefined) { sendError(ws, 'Invalid dht-put message'); return; }
    dhtStore.set(key, { value: Buffer.from(value, 'base64'), timestamp: Date.now() });
    ws.send(JSON.stringify({ type: 'dht-put-ack', key }));
  }

  function handleDhtGet(ws, message) {
    const { key, requestId } = message;
    if (!key) { sendError(ws, 'Invalid dht-get message'); return; }
    const entry = dhtStore.get(key);
    ws.send(JSON.stringify({
      type: 'dht-get-result',
      key,
      requestId,
      value: entry ? entry.value.toString('base64') : null
    }));
  }

  function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message }));
    }
  }

  function broadcast(message, excludePublicKey = null) {
    const messageStr = JSON.stringify(message);
    users.forEach((user, publicKey) => {
      if (publicKey !== excludePublicKey && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(messageStr);
      }
    });
  }
});

// Cleanup old pending signals every 5 minutes
setInterval(() => {
  const now = Date.now();
  pendingSignals.forEach((signals, publicKey) => {
    const filtered = signals.filter(s => (now - (s.timestamp || 0)) < 5 * 60 * 1000);
    if (filtered.length === 0) pendingSignals.delete(publicKey);
    else pendingSignals.set(publicKey, filtered);
  });
  // Cleanup DHT entries older than 24 hours
  dhtStore.forEach((entry, key) => {
    if (now - entry.timestamp > 24 * 60 * 60 * 1000) dhtStore.delete(key);
  });
}, 5 * 60 * 1000);

// Heartbeat: update lastSeen + ping all clients every 30s
setInterval(() => {
  const now = Date.now();
  users.forEach((user, publicKey) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      user.lastSeen = now;
      user.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
    } else {
      // Clean up dead connections
      users.delete(publicKey);
      broadcast({ type: 'user-offline', publicKey }, publicKey);
    }
  });
}, 30 * 1000);

server.listen(PORT, () => {
  console.log(`✅ Signaling server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
