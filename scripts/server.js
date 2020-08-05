const ws = require('ws');

const constants = require('./constants.js');

function Server() {
    const wss = new ws.Server({
        port: constants.SERVER_PORT,
    });

    this.conns = [];
    this.welcomeMessage = {
        's': 't'
    };

    wss.on('connection', (ws) => {
        this.conns.push(ws);

        ws.on('close', () => {
            this.conns.splice(this.conns.indexOf(ws), 1);
        });

        ws.send(JSON.stringify(this.welcomeMessage));
    });

    this.sendMessage = (msg) => {
        for (let conn of this.conns) {
            if (typeof msg == 'string') {
                conn.send(msg);
            } else {
                conn.send(JSON.stringify(msg));
            }
        }
    }
}

module.exports = new Server();