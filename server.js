const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/esp' });

// สถานะ Relay ทั้ง 4 ช่อง [Air1, Air2, Air3, Relay4]
let relayStates = [false, false, false, false];
let autoMode = true;

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------------
// ฟังก์ชันตรวจสอบตารางเวลาทำงาน (คำนวณแยกแต่ละเครื่องอย่างอิสระ)
// -------------------------------------------------------------------------
function checkAutoSchedule() {
    if (!autoMode) return;

    // แปลงเวลาเซิร์ฟเวอร์เป็นเวลาประเทศไทย (UTC+7)
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const thTime = new Date(utc + (3600000 * 7));
    
    const hours = thTime.getHours();
    const minutes = thTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    // 1. เงื่อนไข Air 1 (รวม 4 ชั่วโมง)
    const air1 = (totalMinutes >= 480 && totalMinutes < 540) || // 08:00 - 09:00
                 (totalMinutes >= 600 && totalMinutes < 660) || // 10:00 - 11:00
                 (totalMinutes >= 720 && totalMinutes < 780) || // 12:00 - 13:00
                 (totalMinutes >= 900 && totalMinutes < 960);   // 15:00 - 16:00

    // 2. เงื่อนไข Air 2 (รวม 3 ชั่วโมง)
    const air2 = (totalMinutes >= 540 && totalMinutes < 600) || // 09:00 - 10:00
                 (totalMinutes >= 630 && totalMinutes < 660) || // 10:30 - 11:00
                 (totalMinutes >= 750 && totalMinutes < 780) || // 12:30 - 13:00
                 (totalMinutes >= 870 && totalMinutes < 930);   // 14:30 - 15:30

    // 3. เงื่อนไข Air 3 (รวม 2.5 ชั่วโมง)
    const air3 = (totalMinutes >= 660 && totalMinutes < 720) || // 11:00 - 12:00
                 (totalMinutes >= 780 && totalMinutes < 870);   // 13:00 - 14:30

    let isChanged = false;
    if (relayStates[0] !== air1) { relayStates[0] = air1; isChanged = true; }
    if (relayStates[1] !== air2) { relayStates[1] = air2; isChanged = true; }
    if (relayStates[2] !== air3) { relayStates[2] = air3; isChanged = true; }

    if (isChanged) {
        console.log(`[Auto Schedule] สลับสถานะ: Air1=${air1}, Air2=${air2}, Air3=${air3}`);
        broadcastState();
    }
}

// ตรวจสอบเวลาทุกๆ 1 วินาที เพื่อความแม่นยำในการเปลี่ยนสถานะ
setInterval(checkAutoSchedule, 1000);

// -------------------------------------------------------------------------
// WebSocket Server Handlers
// -------------------------------------------------------------------------
wss.on('connection', (ws, req) => {
    // ส่งสถานะเริ่มต้นเมื่อมี Client หรือ ESP เชื่อมต่อเข้ามา
    ws.send(JSON.stringify({ 
        type: 'INIT_STATE', 
        relays: relayStates, 
        autoMode: autoMode 
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // ฮาร์ดแวร์ ESP รายงานสถานะกลับมา
            if (data.type === 'ESP_CONNECT' || data.type === 'STATE_UPDATE') {
                if (Array.isArray(data.relays) && data.relays.length === 4) {
                    relayStates = data.relays;
                }
                checkAutoSchedule();
                broadcastState();
                return;
            }

            // คำสั่งควบคุมรายช่องจากหน้าเว็บ
            if (data.type === 'CONTROL') {
                const { ch, state } = data;
                if (ch >= 0 && ch < 4) {
                    relayStates[ch] = state;
                    broadcastState();
                }
            } 
            // คำสั่งควบคุมทั้งหมด
            else if (data.type === 'CONTROL_ALL') {
                relayStates = relayStates.map(() => data.state);
                broadcastState();
            }
            // สลับโหมด Auto / Manual
            else if (data.type === 'TOGGLE_AUTO') {
                autoMode = Boolean(data.state);
                console.log(`[Auto Schedule] โหมด Auto: ${autoMode ? 'เปิด' : 'ปิด'}`);
                if (autoMode) {
                    checkAutoSchedule();
                }
                broadcastState();
            }
        } catch (e) {
            console.error('JSON Parse Error:', message);
        }
    });

    ws.on('close', () => {
        // Client disconnect
    });
});

function broadcastState() {
    const payload = JSON.stringify({ 
        type: 'INIT_STATE', 
        relays: relayStates, 
        autoMode: autoMode 
    });
    
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
