# Nexus Chat — WhatsApp-style messenger (Node.js + Socket.io)

## Run
    npm install
    npm start
Open http://localhost:3000 in two browsers/tabs and chat.

## Features
- Quick join with just a name (guest) or register/login with email + password (scrypt-hashed)
- One-to-one private chat, online/offline list, last seen
- Message ticks: sent ✓ / delivered ✓✓ / read ✓✓ (blue)
- Reply to a message (quoted), copy, delete for everyone
- Photo sharing (auto-compressed) with caption + full-screen viewer
- Emoji picker, typing indicator, unread badges, tab-title count
- Sound + browser notifications for new messages
- Stays logged in on refresh / reconnect (session token)
- Fully responsive (mobile: list -> chat with back button)

## Notes
Data is stored in memory (resets on server restart). For production use a database
(MongoDB/PostgreSQL) and HTTPS.
