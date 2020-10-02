var socket = io();

var usernameEl = document.querySelector('.username-input');
var loginFailedMessageEl = document.getElementById('login-failed-message');
var onlinePlayersListEl = document.querySelector('.online-players-list');
var currentlyOnlineEl = document.getElementById('currently-online');
var noOnlinePlayersEl = document.querySelector('.no-online-players');
var loginWrapperEl = document.querySelector('.login-wrapper');
var loggedInAsEl = document.getElementById('logged-in-as');
var opponentNameEl = document.getElementById('opponent-name');
var mySymbolEl = document.getElementById('my-symbol');
var gameWrapperEl = document.querySelector('.game-wrapper');
var turnTextEl = document.getElementById('turn-text');
var turnPlayerEl = document.getElementById('turn-player');
var gameGridEl = document.querySelector('.game-grid');
var gameResultTextEl = document.getElementById('game-result-text');

var onlineUsersNumber = 0;
var loggedIn = false;

var mySymbol;
var currentTurn;

function handleBoxMouseEnter(elm) {
    if (!elm.classList.contains('taken') && currentTurn !== false) {
        elm.classList.add('hover');
        if (currentTurn === 'o') elm.classList.add('o');
        elm.textContent = currentTurn.toUpperCase();
    }
}
function handleBoxMouseLeave(elm) {
    if (!elm.classList.contains('taken') && currentTurn !== false) {
        elm.classList.remove('hover', 'o');
        elm.textContent = '';
    }
}

function handleBoxClick(elm, index) {
    if (!elm.classList.contains('taken') && currentTurn !== false) {
        socket.emit('validate_position', {
            index,
            socketID: socket.id
        })
    }
}

function toggleTurn() {
    turnTextEl.classList.toggle('opponent');
    turnPlayerEl.textContent = turnPlayerEl.textContent === 'Your' ? "Opponent's" : 'Your';
    if (currentTurn === false) {
        currentTurn = mySymbol;
    }
    else currentTurn = false;
}

var toastifyArgs = {
    gravity: 'bottom',
    position: 'right',
    className: 'toast',
}

function setHeightAnimation(el, autoFirst = false) {
    if (autoFirst) {
        el.style.height = 'auto';
    }
    el.style.height = el.scrollHeight + 'px';
}

setHeightAnimation(loggedInAsEl);
setHeightAnimation(gameWrapperEl);
setHeightAnimation(loginWrapperEl, true);
window.addEventListener('resize', debounce(() => {
    setHeightAnimation(loggedInAsEl);
    setHeightAnimation(gameWrapperEl);
    setHeightAnimation(loginWrapperEl, true);
}, 100));

function loginToGame() {
    var pattern = new RegExp("^[a-zA-Z0-9\._-]+$");
    if (usernameEl.value === '') {
        loginFailedMessageEl.textContent = 'Username is required.';
        setHeightAnimation(loginWrapperEl, true);
    }
    else if (!pattern.test(usernameEl.value)) {
        loginFailedMessageEl.textContent = 'Invalid username. Username can only contain characters, digits, dots, underscores and dashes.';
        setHeightAnimation(loginWrapperEl, true);
    }
    else {
        socket.emit('login', {
            username: usernameEl.value
        });
    }
}

function addUser(data) {
    var { username, socketID, lastGame, room } = data;
    var newUserMarkup = `
    <li class="online-player" data-socket-id="${socketID}">
        <hr class="online-players-line">
        <div class="d-flex justify-content-between align-items-end">
            <div>
                <p class="online-player-name">${username} ${ socketID === socket.id ? `<span>(you)</span>` : '' }</p>
                <p class="last-game-date">Last game: ${ lastGame === false ?  "Haven't played yet" : new Date(lastGame) }</p>
            </div>
            <button class="btn btn-primary btn-sm challenge-btn ${room !== 'lobby' ? 'in-room' : ''} ${socketID === socket.id ? 'me' : ''}" ${socketID !== socket.id ? `onclick="challenge('${socketID}')"` : ''}>Challenge</button>
        </div>
    </li>`;
    noOnlinePlayersEl.classList.remove('active');
    onlinePlayersListEl.innerHTML += newUserMarkup;
    currentlyOnlineEl.textContent = ++onlineUsersNumber;
}

function removeUser(socketID) {
    document.querySelector(`[data-socket-id="${socketID}"]`).remove();
    currentlyOnlineEl.textContent = --onlineUsersNumber;
}

function challenge(socketID) {
    socket.emit('challenge', {
        from: socket.id,
        to: socketID
    })
}

function addSymbol(symbol, index) {
    document.querySelectorAll('.game-box')[index].textContent = symbol.toUpperCase();
    document.querySelectorAll('.game-box')[index].classList.remove('hover');
    document.querySelectorAll('.game-box')[index].classList.add('taken');
    if (symbol === 'o') document.querySelectorAll('.game-box')[index].classList.add('o');
}

socket.on('get_online_users', onlineUsers => {
    for (let socketID in onlineUsers) {
        addUser(onlineUsers[socketID]);
    }
})

socket.on('login_fail', data => {
    loginFailedMessageEl.innerHTML = data.errorMessage;
    setHeightAnimation(loginWrapperEl, true);
})

socket.on('login_success_same', data => {
    addUser(data);
    loginWrapperEl.classList.add('hide');
    loggedInAsEl.innerHTML = `You are logged in as <strong>${data.username}</strong>`;
    loggedInAsEl.style.marginTop = '2rem';
    setHeightAnimation(loggedInAsEl);
    document.body.classList.add('logged-in');
    loggedIn = true;
})

socket.on('login_success_others', data => {
    addUser(data);
})

socket.on('lobby_enter', (data) => {
    document.querySelector(`[data-socket-id="${data.socketID}"]`).querySelector('.challenge-btn').classList.remove('in-room');
    gameWrapperEl.classList.add('hide');
})

socket.on('logout_user', data => {
    removeUser(data.socketID);
    if (onlineUsersNumber === 0) {
        noOnlinePlayersEl.classList.add('active')
    }
})

socket.on('send_challenge_request', data => {
    Swal.fire({
        title: `Challenge Request`,
        html: `<strong>${data.challenger.username}</strong> wants to challenge you. Do you accept?`,
        showDenyButton: true,
        icon: 'warning',
        showCancelButton: false,
        confirmButtonText: `Accept`,
        denyButtonText: `Reject`,
        buttonsStyling: false,
        customClass: {
            confirmButton: 'btn btn-success mr-1',
            denyButton: 'btn btn-danger ml-1'
        }
      }).then((result) => {
        if (result.isConfirmed) {
          socket.emit('challenge_request_accept', {
              challenger: data.challenger.socketID,
              other: socket.id
          })
        } else if (result.isDenied) {
            socket.emit('challenge_request_reject', {
                challenger: data.challenger.socketID,
                other: socket.id
            })
        }
      })
})

socket.on('notification_sent', data => {
    var toast = Toastify({
        ...toastifyArgs,
        text: data.message,
        duration: 3000,
        onClick: () => {toast.hideToast()}
    });
    toast.showToast();    
})

socket.on('game_init', data => {
    document.querySelector(`[data-socket-id="${data.player1.socketID}"]`).querySelector('.challenge-btn').classList.add('in-room');
    document.querySelector(`[data-socket-id="${data.player2.socketID}"]`).querySelector('.challenge-btn').classList.add('in-room');
})

function getOpponent(obj1, obj2) {
    return obj1.socketID !== socket.id ? obj1 : obj2;
}

function getMe(obj1, obj2) {
    return obj1.socketID === socket.id ? obj1 : obj2;
}

socket.on('setup_game', (data) => {
    for (let i = 0; i < document.querySelectorAll('.game-box').length; i++) {
        document.querySelectorAll('.game-box')[i].textContent = '';
        document.querySelectorAll('.game-box')[i].classList.remove('o', 'taken');
    }
    var me = getMe(data.player1, data.player2);
    var opponent = getOpponent(data.player1, data.player2);
    opponentNameEl.textContent = opponent.username;
    mySymbolEl.textContent = me.symbol.toUpperCase();
    gameWrapperEl.classList.remove('hide');
    gameGridEl.classList.remove('show-result');
    currentTurn = data.currentTurn;
    mySymbol = me.symbol;
    if (data.currentTurn !== me.symbol) {
        turnPlayerEl.textContent = "Opponent's";
        turnTextEl.classList.add('opponent');
        currentTurn = false;
    }
})

socket.on('set_position', (data) => {
    addSymbol(data.symbol, data.index);
    toggleTurn();
})

socket.on('game_result', data => {
    if (data.result === 'tie') {
        gameResultTextEl.textContent = 'Tie 🤝';
    }
    else {
        if (mySymbol === data.result) gameResultTextEl.textContent = 'You Won 🎉';
        else gameResultTextEl.textContent = 'You Lost 😢';
    }
    gameGridEl.classList.add('show-result');
})

document.querySelectorAll('.game-box').forEach((elm, index) => {
    elm.addEventListener('mouseenter', () => handleBoxMouseEnter(elm));
    elm.addEventListener('mouseleave', () => handleBoxMouseLeave(elm));
    elm.addEventListener('click', () => handleBoxClick(elm, index));
})