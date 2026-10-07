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


<img width="1917" height="989" alt="1" src="https://github.com/user-attachments/assets/52d64ac1-874b-40c8-8dea-c9c0a70523f5" />
<img width="1919" height="983" alt="2" src="https://github.com/user-attachments/assets/1245de58-2136-4ad6-885a-154a6ff73d1c" />
<img width="1918" height="996" alt="3" src="https://github.com/user-attachments/assets/f1d9fd91-e8fc-4638-9886-0ee1d88957f8" />
<img width="1919" height="1001" alt="4" src="https://github.com/user-attachments/assets/c783dc30-9aec-4dc2-bbb9-01c0e6035b6b" />

