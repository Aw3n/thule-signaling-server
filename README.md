# Serveur de Signaling WebRTC pour Thule Messenger

Ce serveur permet aux clients Thule Messenger de se découvrir et d'établir des connexions WebRTC P2P.

## Installation

```bash
cd server
npm install
```

## Démarrage

### Mode Production
```bash
npm start
```

### Mode Développement (avec auto-reload)
```bash
npm run dev
```

Le serveur démarre sur le port **8080** par défaut.

## Configuration

Vous pouvez changer le port via une variable d'environnement:

```bash
PORT=3000 npm start
```

## Endpoints

### WebSocket
- **URL:** `ws://localhost:8080`
- **Protocole:** WebSocket pour la signalisation

### HTTP Health Check
- **URL:** `http://localhost:8080/health`
- **Méthode:** GET
- **Réponse:**
  ```json
  {
    "status": "ok",
    "users": 5,
    "uptime": 12345.67
  }
  ```

## Messages WebSocket

### Client → Serveur

#### 1. Register (S'enregistrer)
```json
{
  "type": "register",
  "publicKey": "abc123...",
  "username": "Alice"
}
```

#### 2. Find User (Rechercher un utilisateur)
```json
{
  "type": "find-user",
  "publicKey": "def456..."
}
```

#### 3. Signal (Envoyer un signal WebRTC)
```json
{
  "type": "signal",
  "to": "def456...",
  "from": "abc123...",
  "signal": { /* WebRTC signal data */ }
}
```

#### 4. List Users (Lister les utilisateurs)
```json
{
  "type": "list-users"
}
```

#### 5. Ping
```json
{
  "type": "ping"
}
```

### Serveur → Client

#### 1. Registered (Confirmation d'enregistrement)
```json
{
  "type": "registered",
  "publicKey": "abc123...",
  "timestamp": 1234567890
}
```

#### 2. User Found (Utilisateur trouvé)
```json
{
  "type": "user-found",
  "publicKey": "def456...",
  "online": true,
  "username": "Bob",
  "lastSeen": 1234567890
}
```

#### 3. Signal (Signal WebRTC reçu)
```json
{
  "type": "signal",
  "from": "abc123...",
  "signal": { /* WebRTC signal data */ }
}
```

#### 4. User Online (Utilisateur en ligne)
```json
{
  "type": "user-online",
  "publicKey": "ghi789...",
  "username": "Charlie"
}
```

#### 5. User Offline (Utilisateur hors ligne)
```json
{
  "type": "user-offline",
  "publicKey": "ghi789..."
}
```

#### 6. User List (Liste des utilisateurs)
```json
{
  "type": "user-list",
  "users": [
    {
      "publicKey": "abc123...",
      "username": "Alice",
      "lastSeen": 1234567890
    }
  ],
  "count": 1
}
```

#### 7. Pong
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

#### 8. Error
```json
{
  "type": "error",
  "message": "Invalid message format"
}
```

## Fonctionnalités

- ✅ Enregistrement des utilisateurs
- ✅ Découverte d'utilisateurs
- ✅ Signalisation WebRTC
- ✅ Notifications en temps réel (utilisateur en ligne/hors ligne)
- ✅ Stockage temporaire des signaux pour utilisateurs hors ligne
- ✅ Nettoyage automatique des signaux anciens (5 minutes)
- ✅ Health check HTTP

## Sécurité

⚠️ **Ce serveur est une version de développement/test.**

Pour la production, ajoutez:
- Authentification des utilisateurs
- Rate limiting
- HTTPS/WSS
- Validation des données
- Logging approprié
- Monitoring

## Déploiement

### Heroku
```bash
heroku create thule-signaling
git push heroku main
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
```

### VPS (Ubuntu)
```bash
# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Cloner et installer
git clone <repo>
cd server
npm install --production

# Utiliser PM2 pour la gestion
npm install -g pm2
pm2 start signaling-server.js --name thule-signaling
pm2 save
pm2 startup
```

## Logs

Le serveur affiche:
- Connexions/déconnexions des utilisateurs
- Signaux transférés
- Erreurs

Exemple:
```
Signaling server starting on port 8080...
✅ Signaling server running on port 8080
   Health check: http://localhost:8080/health
   WebSocket: ws://localhost:8080
New connection established
User registered: Alice (abc12345...)
Total users online: 1
Signal forwarded from abc12345... to def45678...
User disconnected: abc12345...
```

## Tests

### Test avec wscat
```bash
npm install -g wscat
wscat -c ws://localhost:8080

# Envoyer un message
> {"type":"register","publicKey":"test123","username":"TestUser"}
```

### Test avec curl (health check)
```bash
curl http://localhost:8080/health
```

## Support

Pour toute question ou problème, consultez la documentation principale de Thule Messenger.
