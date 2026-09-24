const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/esp' });

// เก็บสถานะ Relay ทั้ง 4 ช่อง [Air1, Air2, Air3, MotorPump]
let relayStates = [false, false, false, false];
let autoMode = true; // เปิดใช้งานโหมดอัตโนมัติเป็นค่าเริ่มต้น

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------------
// ฟังก์ชันคำนวณเวลาประเทศไทย (UTC+7) และตรวจสอบตารางการทำงาน
// -------------------------------------------------------------------------
function checkAutoSchedule() {
    if (!autoMode) return; // หากปิดโหมด Auto จะไม่ปรับค่าอัตโนมัติ

    // แปลงเวลาเซิร์ฟเวอร์เป็นเวลาประเทศไทย (UTC+7)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const thTime = new Date(utc + (3600000 * 7));
    
    const hours = thTime.getHours();
    const minutes = thTime.getMinutes();
    const totalMinutes = hours * 60 + minutes; // แปลงเวลาเป็นนาทีรวมนับจาก 00:00

    let air1 = false;
    let air2 = false;
    let air3 = false;

    // ตรวจสอบเงื่อนไขตาม Timing Diagram (ช่วงเวลาในหน่วยนาที)
    if (totalMinutes >= 480 && totalMinutes < 510) {          // 08:00 - 08:30
        air1 = true;
    } else if (totalMinutes >= 510 && totalMinutes < 540) {   // 08:30 - 09:00
        air2 = true;
    } else if (totalMinutes >= 540 && totalMinutes < 570) {   // 09:00 - 09:30
        air1 = true;
    } else if (totalMinutes >= 570 && totalMinutes < 600) {   // 09:30 - 10:00
        air2 = true;
    } else if (totalMinutes >= 600 && totalMinutes < 630) {   // 10:00 - 10:30
        air1 = true;
    } else if (totalMinutes >= 630 && totalMinutes < 660) {   // 10:30 - 11:00
        air2 = true;
    } else if (totalMinutes >= 660 && totalMinutes < 690) {   // 11:00 - 11:30
        air3 = true;
    } else if (totalMinutes >= 690 && totalMinutes < 720) {   // 11:30 - 12:00
        air1 = true; air3 = true;
    } else if (totalMinutes >= 720 && totalMinutes < 750) {   // 12:00 - 12:30
        air2 = true; air3 = true;
    } else if (totalMinutes >= 750 && totalMinutes < 840) {   // 12:30 - 14:00
        air3 = true;
    } else if (totalMinutes >= 840 && totalMinutes < 870) {   // 14:00 - 14:30
        air1 = true; air3 = true;
    } else if (totalMinutes >= 870 && totalMinutes < 900) {   // 14:30 - 15:00
        air2 = true;
    } else if (totalMinutes >= 900 && totalMinutes < 930) {   // 15:00 - 15:30
        air3 = true;
    } else if (totalMinutes >= 930 && totalMinutes < 960) {   // 15:30 - 16:00
        air1 = true;
    }

    // ตรวจสอบว่ามีการเปลี่ยนแปลงสถานะหรือไม่
    let isChanged = false;
    if (relayStates[0] !== air1) { relayStates[0] = air1; isChanged = true; }
    if (relayStates[1] !== air2) { relayStates[1] = air2; isChanged = true; }
    if (relayStates[2] !== air3) { relayStates[2] = air3; isChanged = true; }

    // หากมีการเปลี่ยนแปลง ให้กระจายสถานะใหม่ไปยัง Web UI และ ESP8266
    if (isChanged) {
        broadcastState();
    }
}

// ตรวจสอบเวลาทุกๆ 10 วินาที
setInterval(checkAutoSchedule, 10000);

// -------------------------------------------------------------------------
// WEBSOCKET SERVER EVENT HANDLERS
// -------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
    console.log('Client connected:', req.socket.remoteAddress);

    // ส่งสถานะปัจจุบันและโหมด Auto ให้ผู้ใช้งาน
    ws.send(JSON.stringify({ type: 'INIT_STATE', relays: relayStates, autoMode: autoMode }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // สั่งเปิด-ปิดรายช่อง (Manual Control)
            if (data.type === 'CONTROL') {
                const { ch, state } = data;
                if (ch >= 0 && ch < 4) {
                    relayStates[ch] = state;
                    broadcastState();
                }
            } 
            // สั่งเปิด-ปิดทั้งหมด
            else if (data.type === 'CONTROL_ALL') {
                relayStates = relayStates.map(() => data.state);
                broadcastState();
            }
            // สลับโหมดการทำงาน Auto / Manual
            else if (data.type === 'TOGGLE_AUTO') {
                autoMode = data.state;
                if (autoMode) {
                    checkAutoSchedule(); // คำนวณตารางเวลาทันทีที่เปิดโหมด Auto
                }
                broadcastState();
            }
        } catch (e) {
            console.error('Invalid JSON:', message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

function broadcastState() {
    const payload = JSON.stringify({ type: 'INIT_STATE', relays: relayStates, autoMode: autoMode });
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
