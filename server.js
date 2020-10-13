const app = require('express')();
const path = require('path');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const morgan = require('morgan');

const { unset, findKey, has, escape, trim, concat, forEach, random, assign, get, reject } = require('lodash');

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

const leaveRoom = async (socketID, room) => {
    return new Promise((resolve, reject) => {
        if (checkIsOnline(socketID)) {
            const socket = io.sockets.sockets[socketID];
            socket.leave(room, (err) => {
                if (err) return reject(err);
                onlineUsers[socketID].room = '';
                if (rooms[room].player1 === undefined || rooms[room].player2 === undefined) {
                    unset(rooms, room);
                }
                else if (rooms[room].player1.socketID === socketID) {
                    rooms[room].player1 = undefined;
                }
                else rooms[room].player2 = undefined;
                return resolve(true);
            })
        }
        return resolve(false);
    })
}

const hideGame = (socketID) => {
    io.sockets.sockets[socketID].emit('hide_game');
}

const enterLobby = async (socketID, willHideGame = true) => {
    return new Promise((resolve, reject) => {
        if (checkIsOnline(socketID)) {
            const socket = io.sockets.sockets[socketID];
            socket.join('lobby', (err) => {
                if (err) return reject(false);
                onlineUsers[socketID].room = 'lobby';
                if (willHideGame) hideGame(socketID);
                io.emit('lobby_enter', {
                    socketID
                });
                return resolve(true);
            })
        }
        return resolve(false);
    })
}

const toggleTurn = (room) => {
    if (checkRoom(room)) rooms[room].currentTurn = rooms[room].currentTurn === 'x' ? 'o' : 'x';
    return false;
}

const checkRoomTable = (room, i, j, symbol, occ = 1, direction = 'all') => {
    if (i < 0 || i >= 3 || j < 0 || j >= 3) return;
    if (symbol !== rooms[room].table[i][j]) return;
    if (occ == 3) {
        rooms[room].result = symbol;
        return;
    }
    if (direction === 'all') {
        checkRoomTable(room, i+1, j, symbol, occ+1, 'bottom');
        checkRoomTable(room, i, j+1, symbol, occ+1, 'right');

        checkRoomTable(room, i+1, j+1, symbol, occ+1, 'bottomright');
        checkRoomTable(room, i+1, j-1, symbol, occ+1, 'bottomleft');
    }
    else if (direction === 'bottom') checkRoomTable(room, i+1, j, symbol, occ+1, 'bottom');
    else if (direction === 'right') checkRoomTable(room, i, j+1, symbol, occ+1, 'right');
    else if (direction === 'bottomright') checkRoomTable(room, i+1, j+1, symbol, occ+1, 'bottomright');
    else if (direction === 'bottomleft') checkRoomTable(room, i+1, j-1, symbol, occ+1, 'bottomleft');
}

const updateGameStatus = (room) => {
    let placesTaken = 0;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            if (rooms[room].table[i][j] !== '') {
                placesTaken++;
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
            currentTurn,
        }
        rooms[room] = assign(rooms[room], obj);
        rooms[room].table = Array.from(Array(3), () => Array.from(Array(3), () => ''));
        rooms[room].result = undefined;
        io.to(room).emit('setup_game', obj);
        return true;
    }
    return false;
}

const getOpponent = (socketID, obj1, obj2) => {
    return obj1.socketID !== socketID ? obj1 : obj2;
}

const playAgainRequest = (socket, data) => {
    const room = getUserRoom(socket.id);
    if (socket.id === data.socketID && room !== false && rooms[room].player1 && rooms[room].player2) {
        const opponent = getOpponent(socket.id, rooms[room].player1, rooms[room].player2);
        challenge(socket, socket.id, opponent.socketID, {
            denyButtonText: 'Reject',
            otherMessage: `<strong>${onlineUsers[data.socketID].username}</strong> Wants to play again. Do you accept to play again?`
        });
    }
    return false;
}

const joinRoom = async (socketID, room) => {
    return new Promise((resolve, reject) => {
        if (checkIsOnline(socketID)) {
            if (room === getUserRoom(socketID)) {
                resolve(true)
            }
            else {
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
        }
        else resolve(false);
    })
}

const userExists = (username) => findKey(onlineUsers, value => value.username === username) !== undefined;
const loginUser = async (socket, data) => {
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
    await enterLobby(socket.id) 
    socket.emit('login_success_same', user);
    socket.broadcast.emit('login_success_others', user);
    return true;
}

const logoutUser = async (socketID) => {
    if (checkIsOnline(socketID)) {
        const room = onlineUsers[socketID].room;
        unset(onlineUsers, socketID);
        if (room != 'lobby') {
            if (rooms[room].player1 !== undefined) {
                await enterLobby(rooms[room].player1.socketID)
            }
            if (rooms[room].player2) {
                await enterLobby(rooms[room].player2.socketID)
            }
        }
        io.emit('logout_user', {
            socketID
        });
        return true;
    }
}

const sendNotification = (socket, to, obj, cb) => {
    obj = {
        type: 'toast',
        ...obj
    };
    if (to === socket.id) {
        socket.emit('notification_sent', obj)
    }
    else {
        socket.to(to).emit('notification_sent', obj)
    }
    return true;
}

const challenge = (socket, from, to, obj = {}) => {
    if ( checkTwoDifferentPlayersOnline(from ,to) ) {
        socket.to(to).emit('send_challenge_request', {
            challenger: onlineUsers[from],
            message: get(obj, 'otherMessage', `<strong>${onlineUsers[from].username}</strong> wants to challenge you. Do you accept?`),
            title: get(obj, 'title', `Challenge Request`),
            confirmButtonText: get(obj, 'confirmButtonText', 'Accept'),
            denyButtonText: get(obj, 'denyButtonText', 'Reject')
        })
        sendNotification(socket, socket.id, {
            message: get(obj, 'challengerMessage', `A challenge request has been sent to <strong>${onlineUsers[to].username}</strong>`)
        })
        return true;
    }
    return false;
}

const onChallengeRequestReject = (socket, data) => {
    if ( checkTwoDifferentPlayersOnline(data.challenger, data.other) ) {
        sendNotification(socket, data.challenger, {
            message: `<strong>${onlineUsers[data.other].username}</strong> rejected the challenge.`
        });
    }
}

const onChallengeRequestAccept = async (socket, data) => {
    if (checkTwoDifferentPlayersOnline(data.challenger, data.other)) {
        if (getUserRoom(data.challenger) !== getUserRoom(data.other)) {
            sendNotification(socket, data.challenger, {
                message: `<strong>${onlineUsers[data.other].username}</strong> is in another room.`
            })
            return;
        }
        const room = getUserRoom(socket.id) ? getUserRoom(socket.id) : data.challenger + '|' + data.other + '|' + Math.random().toString(36).slice(2);

        if ( await joinRoom(data.challenger, room) === true && await joinRoom(data.other, room) === true ) {
            sendNotification(socket, data.challenger, {
                message: `<strong>${onlineUsers[data.other].username}</strong> accepted the challenge.`
            })
            setupGame(room, onlineUsers[data.challenger], onlineUsers[data.other]);
            onlineUsers[data.other].lastGame = 'now';
            onlineUsers[data.challenger].lastGame = 'now';
            io.emit('game_init', {
                player1: onlineUsers[data.challenger],
                player2: onlineUsers[data.other]
            })
        }

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

const deco = async (socket) => {
    const room = getUserRoom(socket.id);
    if (room) {
        const opponent = getOpponent(socket.id, rooms[room].player1, rooms[room].player2);
        await leaveRoom(socket.id, room);
        await enterLobby(socket.id);

        await leaveRoom(opponent.socketID, room);
        await enterLobby(opponent.socketID, false);

        io.sockets.sockets[opponent.socketID].emit('game_result', {
            result: 'dc'
        })
    }
}

const returnToLobby = async (socket) => {
    const room = getUserRoom(socket.id);
    if (room) {
        if (rooms[room].result === undefined) { // Game did not finish 
            socket.emit('alert_room_exit', {
                message: 'You will lose if you exited the match. Are you sure you want to exit?',
                confirmButtonText: 'Yes',
                denyButtonText: 'No'
            })
        }
        else {
            // make both exit the room
            if (rooms[room].player1 !== undefined && rooms[room].player2 !== undefined) {
                const opponent = getOpponent(socket.id, rooms[room].player1, rooms[room].player2);
                io.sockets.sockets[opponent.socketID].emit('opponent_left_room', {
                    opponent
                })
                const date = new Date().toISOString()
                onlineUsers[socket.id].lastGame = date;
                onlineUsers[opponent.socketID].lastGame = date;
                io.emit('update_last_game', {
                    player1: onlineUsers[socket.id],
                    player2: onlineUsers[opponent.socketID],
                    date
                })
            }
            await leaveRoom(socket.id, room);
            await enterLobby(socket.id);
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.emit('get_online_users', onlineUsers);

    socket.on('login', async (data) => await loginUser(socket, data));

    socket.on('challenge', (data) => challenge(socket, data.from, data.to));

    socket.on('play_again_request', (data) => playAgainRequest(socket, data))

    socket.on('challenge_request_reject', (data) => onChallengeRequestReject(socket, data));

    socket.on('return_to_lobby', async () => await returnToLobby(socket));

    socket.on('dc', async () => await deco(socket))

    socket.on('validate_position', (data) => validatePostition(socket, data));

    socket.on('challenge_request_accept', async (data) => await onChallengeRequestAccept(socket, data));

    socket.on('disconnect', async () => await logoutUser(socket.id));
})

server.listen(PORT, function() {
    console.log(`Server is running at port ${PORT}`);
})