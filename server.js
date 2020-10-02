const app = require('express')();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const morgan = require('morgan');

const { unset, findKey, has, escape, trim, concat, forEach, random, assign } = require('lodash');

app.use( require('express').static( path.join(__dirname, 'public')) );
app.use(morgan(':method :url :status [:res[content-length]] - :response-time ms'));

const routes = require('./routes/route');

app.response.relativeSendFile = function(filePath, options, fn) {
    return this.sendFile.apply(this, [ path.join(__dirname, filePath), options, fn ])
}

app.use('/', routes);

const PORT = process.env.PORT || 5000;

const onlineUsers = {};
const rooms = {};

const checkIsOnline = (socketID) => has(onlineUsers, socketID);
const checkTwoPlayersOnline = (socketID1, socketID2, mustBeDifferent = false) => {
    if (mustBeDifferent) return checkIsOnline(socketID1) && checkIsOnline(socketID2) && socketID1 !== socketID2;
    return checkIsOnline(socketID1) && checkIsOnline(socketID2);
}
const checkTwoDifferentPlayersOnline = (socketID1, socketID2) => checkTwoPlayersOnline(socketID1, socketID2, true);

const checkRoom = (room) => has(rooms, room);

const getUserRoom = (socketID) => {
    if (checkIsOnline(socketID)) {
        const room = onlineUsers[socketID].room;
        if (checkRoom(room)) {
            return room;
        }
    }
    return false;
}

const enterLobby = (socketID) => {
    if (checkIsOnline(socketID)) {
        const socket = io.sockets.sockets[socketID];
        socket.join('lobby', (err) => {
            if (err) return false;
            onlineUsers[socketID].room = 'lobby';
            io.emit('lobby_enter', {
                socketID
            })
        })
    
        return true;
    }
}

/* const leaveRoom = (socketID, room) => {
    if (checkIsOnline(socketID)) {

    }
    io.sockets.sockets[]
} */

const toggleTurn = (room) => {
    if (checkRoom(room)) rooms[room].currentTurn = rooms[room].currentTurn === 'x' ? 'o' : 'x';
    return false;
}

const checkRoomTable = (room, i, j, symbol, occ = 1) => {
    if (i < 0 || i >= 3 || j < 0 || j >= 3) return;
    if (symbol !== rooms[room].table[i][j]) return;
    if (occ == 3) {
        rooms[room].result = symbol;
        return;
    }

    checkRoomTable(room, i+1, j, symbol, occ+1);
    checkRoomTable(room, i, j+1, symbol, occ+1);

    checkRoomTable(room, i+1, j+1, symbol, occ+1);
    checkRoomTable(room, i+1, j-1, symbol, occ+1);
}

const updateGameStatus = (room) => {
    let placesTaken = 0;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (rooms[room].table[i][j] !== '') {
                checkRoomTable(room, i, j, rooms[room].table[i][j]);
                if (rooms[room].result) return rooms[room].result;
            }
        }
    }
    if (placesTaken === 9) {
        rooms[room].result = 'tie';
        return 'tie';
    };
    return false;
}

const setupGame = (room, player1, player2) => {
    if (checkRoom(room)) {
        const player1Symbol = random() === 1 ? 'x' : 'o';
        const player2Symbol = player1Symbol === 'x' ? 'o' : 'x';
        const currentTurn = ['x','o'][random()];
        const obj = {
            player1: {...player1, symbol: player1Symbol},
            player2: {...player2, symbol: player2Symbol},
            currentTurn
        }
        rooms[room] = assign(rooms[room], obj);
        rooms[room].table = Array.from(Array(3), () => Array.from(Array(3), () => ''));
        io.to(room).emit('setup_game', obj);
        return true;
    }
    return false;
}

const joinRoom = async (socketID, room) => {
    return new Promise((resolve, reject) => {
        if (checkIsOnline(socketID)) {
            io.sockets.sockets[socketID].join(room, (err) => {
                if (err) reject(err);
                onlineUsers[socketID].room = room;
                if (typeof rooms[room] === "undefined") {
                    rooms[room] = [socketID];
                }
                else rooms[room] = concat(rooms[room], socketID);
                resolve(true);
            })
        }
        else resolve(false);
    })
}

const userExists = (username) => findKey(onlineUsers, value => value.username === username) !== undefined;
const loginUser = (socket, data) => {
    const pattern = new RegExp("^[a-zA-Z0-9\._-]+$");
    const username = trim(escape(data.username));
    if (username === '') {
        socket.emit('login_fail', {
            errorMessage: 'Username is required.'
        });
        return false;
    }
    else if (!pattern.test(username)) {
        socket.emit('login_fail', {
            errorMessage: 'Invalid username. Username can only contain characters, digits, dots, underscores and dashes'
        });
        return false;
    }
    if (userExists(username)) {
        socket.emit('login_fail', {
            errorMessage: `This username has already been taken, please choose another one`
        });
        return false;
    }

    const user = {
        username,
        lastGame: false,
        socketID: socket.id,
        room: false
    }
    onlineUsers[socket.id] = user;
    enterLobby(socket.id);
    socket.emit('login_success_same', user);
    socket.broadcast.emit('login_success_others', user);

    return true;
}

const logoutUser = (socketID) => {
    if (checkIsOnline(socketID)) {
        const room = onlineUsers[socketID].room;
        unset(onlineUsers, socketID);
        if (room != 'lobby') {
            forEach(rooms[room], (socketID) => enterLobby(socketID))
        }
        io.emit('logout_user', {
            socketID
        });
        return true;
    }
}

const sendNotification = (socket, to, message) => {
    if (to === socket.id) {
        socket.emit('notification_sent', {
            message
        })
    }
    else {
        socket.to(to).emit('notification_sent', {
            message
        })
    }
    return true;
}

const challenge = (socket, from, to) => {
    if ( checkTwoDifferentPlayersOnline(from ,to) ) {
        socket.to(to).emit('send_challenge_request', {
            challenger: onlineUsers[from]
        })
        sendNotification(socket, socket.id, `A challenge request has been sent to <strong>${onlineUsers[to].username}</strong>`)
        return true;
    }
    return false;
}

const onChallengeRequestReject = (data) => {
    if ( checkTwoDifferentPlayersOnline(data.challenger, data.other) ) {
        sendNotification(socket, data.challenger, `<strong>${onlineUsers[data.other].username}</strong> rejected the challenge.`);
    }
}

const onChallengeRequestAccept = async (socket, data) => {
    const room = data.challenger + '|' + data.other + '|' + Math.random().toString(36).slice(2);

    if ( await joinRoom(data.challenger, room) === true && await joinRoom(data.other, room) === true ) {
        setupGame(room, onlineUsers[data.challenger], onlineUsers[data.other]);
        io.emit('game_init', {
            player1: onlineUsers[data.challenger],
            player2: onlineUsers[data.other]
        })
    }
}

const validatePostition = (socket, data) => {
    const r = Math.floor(data.index / 3);
    const c = data.index % 3;
    if (r >= 0 && r < 3 && c >= 0 && c < 3) {
        const room = getUserRoom(data.socketID);
        if (room) {
            if (rooms[room].table[r][c] === '' && socket.id === data.socketID && !rooms[room].result) {
                const symbol = rooms[room].player1.socketID === socket.id ? rooms[room].player1.symbol : rooms[room].player2.symbol;
                toggleTurn(room);
                rooms[room].table[r][c] = symbol;
                io.to(room).emit('set_position', {
                    symbol,
                    index: data.index
                })
                const result = updateGameStatus(room);
                if (result) {
                    io.to(room).emit('game_result', {
                        result
                    });
                }
                return true;
            }
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.emit('get_online_users', onlineUsers);

    socket.on('login', (data) => loginUser(socket, data))

    socket.on('challenge', (data) => challenge(socket, data.from, data.to))

    socket.on('challenge_request_reject', (data) => onChallengeRequestReject(data))

    socket.on('validate_position', (data) => validatePostition(socket, data));

    socket.on('challenge_request_accept', async (data) => await onChallengeRequestAccept(socket, data));

    socket.on('disconnect', () => logoutUser(socket.id));
})

server.listen(PORT, function() {
    console.log(`Server is running at port ${PORT}`);
})