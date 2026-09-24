const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/esp' });

// เก็บสถานะ Relay ทั้ง 4 ช่อง (false = OFF, true = ON)
let relayStates = [false, false, false, false];
let espSocket = null;

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws, req) => {
    console.log('Client connected:', req.socket.remoteAddress);

    // ส่งสถานะปัจจุบันให้ผู้ที่เพิ่งเชื่อมต่อเข้ามา
    ws.send(JSON.stringify({ type: 'INIT_STATE', relays: relayStates }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'CONTROL') {
                const { ch, state } = data;
                if (ch >= 0 && ch < 4) {
                    relayStates[ch] = state;
                    broadcastState();
                }
            } else if (data.type === 'CONTROL_ALL') {
                relayStates = relayStates.map(() => data.state);
                broadcastState();
            }
        } catch (e) {
            console.error('Invalid JSON received:', message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// บอร์ดแคสต์สถานะไปยังทุก Client และ ESP8266
function broadcastState() {
    const payload = JSON.stringify({ type: 'INIT_STATE', relays: relayStates });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Smart Office Server running on port ${PORT}`);
});
