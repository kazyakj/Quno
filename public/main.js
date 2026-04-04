const socket = io({autoConnect: false});

const cdWidth = 120;
const cdHeight = 180;
const cards = new Image();
const back = new Image();
let socketId = -1;
let playerId = -1;
let players = 0;
let playerName;

let isPlayerA = false;
let playerAName = null;
let currentColor = null;
let bootTargetId = null;
let requiredPlay = [];
let playersInLobby = [];

const sidePanel = document.getElementById('side-panel');
const collapseButton = document.getElementById('collapse-btn');

collapseButton.addEventListener('click', () => {
    sidePanel.classList.toggle('collapsed');
});

// Connect player to the server
socket.on('connect', function() {
    socketId = socket.id;
    socket.emit('requestJoin', playerName);
});

// Set the game host
socket.on('setHost', function(name) {
    playerAName = name;
});

// Show game controls to the host
socket.on('isPlayerA', function() {
    isPlayerA = true;
    document.getElementById('btnStart').style.display="inline-block";
    document.getElementById('btnOptions').style.display="inline-block";

    updateStartButtonState();
});

// Update the state of the start button based on number of players
function updateStartButtonState() {
    const startBtn = document.getElementById('btnStart');
    const lobbyCount = playersInLobby.length;

    if (!isPlayerA) return;

    if (lobbyCount > 1) {
        startBtn.disabled = false;
        startBtn.value = 'Start New Match';
    } else {
        startBtn.disabled = true;
        startBtn.value = 'Waiting for Players';
    }
}

// Update game options
socket.on('updateOptions', function(options) {
    window.playWildDraw4Enabled = options.playWildDraw4;
});

// Start the game
socket.on('gameStarted', function(playerList) {
    players = playerList.length;
    document.getElementById('waitingOverlay').style.display="none";

    playSound('audio/game-start.wav', 0.2);

    // Show/hide elements for in-game state
    document.getElementById("status").style.display="none";
    document.getElementById('btnDeal').style.display="none";
    document.getElementById('uno-buttons').style.display="flex";
    document.getElementById('discard').style.display="inline-block";

    // Get this player's ID
    for(let i = 0; i < players; i++) {
        if(playerList[i].SocketID == socketId) {
            playerId = playerList[i].PlayerID;
        }
    }

    // Display players
    createPlayersUI(playerList);
});

// Show or hide waiting overlay for non-host players
function updateWaitingOverlay() {
    const overlay = document.getElementById('waitingOverlay');
    if (!isPlayerA) {
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

// Update the player list when a new player joins
socket.on('newPlayer', function(data) {
    const {players: lobbyPlayers, host: hostName} = data;
    const playerListDiv = document.getElementById('playerList');
    playerListDiv.innerHTML = "<strong>Players:</strong>&nbsp;";
    
    lobbyPlayers.forEach(name => {
        const span = document.createElement('span');
        span.style.marginRight = '10px';

        const isHost = (name === hostName);
        const displayName = isHost ? `<span class="crown">👑</span>${name}` : name;
        span.innerHTML = displayName;

        if(isPlayerA) {
            if (name === playerName) {
                span.title = 'You (Host)';
                span.style.cursor = 'default';
            } else {
                span.style.cursor = 'pointer';
                span.title = 'Click to boot player';
                span.addEventListener('click', () => showBootModal(name));
            }
        } else {
            span.title = isHost ? 'Host' : '';
        }

        playerListDiv.appendChild(span);
    });

    playersInLobby = lobbyPlayers;
    if (isPlayerA) {
        updateStartButtonState();
    } else {
        updateWaitingOverlay();
    }
});

// Display the buttons to let the player pick a color after a wild is played
socket.on('chooseColor', function() {
    document.getElementById('color-buttons').style.display="flex";

    const hand = document.getElementById('hand_' + playerId);
    if (hand) {
        hand.querySelectorAll('.card').forEach(c => c.classList.add('unplayable'));
    }
});

// Display which color was selected after a wild is played
socket.on('colorChosen', function(color) {
    currentColor = color;
    document.getElementById('color-bar').style.background=color;
});

// Hide the color bar after move past a wild
socket.on('hideColor', function() {
    document.getElementById('color-bar').style.background="rgb(184, 184, 184)";
});

// Update the list of allowable plays for the player
socket.on('requiredPlay', list => {
    const myTurn = document.getElementById('player_' + playerId).classList.contains('active');
    if (!myTurn) return;

    requiredPlay = list;

    const topCard = getTopCard();
    
    updatePlayableCards(topCard, currentColor);
});

// Handle turn change
socket.on('turnChange', function(PlayerID) {
    // Mark all players as inactive
    document.querySelectorAll('.player').forEach(p => p.classList.remove('active'));

    // Mark the player whose turn it is as active
    document.getElementById('player_' + PlayerID).classList.add('active');

    if(PlayerID == playerId) {
        playSound('audio/turn-change.wav');

        const topCard = getTopCard();
        
        updatePlayableCards(topCard, currentColor);
    } else {
        const hand = document.getElementById('hand_' + playerId);
        if (hand) {
            hand.querySelectorAll('.card').forEach(c => c.classList.add('unplayable'));
        }
    }
});

// Handle Uno call on themself
socket.on('calledUnoMe', function() {
    const btn = document.getElementById('btnUnoMe');
    if (btn) {
        btn.disabled = true;
        btn.style.background = 'gray';
    }
});

// Undo uno call on themself
socket.on('notCalledUnoMe', function() {
    const btn = document.getElementById('btnUnoMe');
    if (btn) {
        btn.disabled = false;
        btn.style.background = '#222';
    }
});

// Handle Uno call on another player
socket.on('calledUnoYou', function() {
    const btn = document.getElementById('btnUnoYou');
    if (btn) {
        btn.disabled = true;
        btn.style.background = 'gray';
    }
});

// Undo Uno call on another player
socket.on('notCalledUnoYou', function() {
    const btn = document.getElementById('btnUnoYou');
    if (btn) {
        btn.disabled = false;
        btn.style.background = '#222';
    }
});

// Update the points of the player who won the game
socket.on('updateScore', function(player, points) {
    document.getElementById('points_' + player).innerHTML = points;
});

// Handle game over
socket.on('gameOver', function(playerName) {
    playSound('audio/game-over.wav');

    // Display a winner message
    document.getElementById('status').innerHTML = playerName + ' WON';
    document.getElementById("status").style.display="inline-block";

    // Display the deal button to the player in control of the game
    if(isPlayerA) {
        document.getElementById("btnDeal").style.display="inline-block";
    }
});

// Render a card in a player's hand
socket.on('renderCard', function(card, player) {
    let hand = document.getElementById('hand_' + player.PlayerID);
    let cardObj = getCardUI(card, player);
    cardObj.classList.add('unplayable');

    hand.appendChild(cardObj);

    repositionCards(player);

    let myTurn = document.getElementById('player_' + playerId).classList.contains('active');

    if(player.SocketID == socketId && myTurn) {
        const topCard = getTopCard();

        const activeColor = currentColor || topCard.Color;

        updatePlayableCards(topCard, activeColor);
    }
});

// Display log messages
socket.on('logMessage', function(message) {
    const messageContainer = document.getElementById('message-container');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    const colors = {
        red: '#FF5555',
        yellow: '#FFAA01',
        green: '#55AA55',
        blue: '#5455FF',
        black: 'black'
    };
    let formattedMessage = message;

    for (const [color, hex] of Object.entries(colors)) {
        const regex = new RegExp(`\\b${color}\\b`, 'gi');
        formattedMessage = formattedMessage.replace(
            regex,
            `<span style="color: ${hex}; font-weight: bold;">${color}</span>`
        );
    }

    messageElement.innerHTML = formattedMessage;
    messageContainer.insertBefore(messageElement, messageContainer.firstChild);
});

// Create the UI element for a card
function getCardUI(card, player) {
    let cardObj = document.createElement('div');

    cardObj.className = 'card';
    cardObj.id = 'card_' + card.ID;
    cardObj.setAttribute('dataCardColor', card.Color);
    cardObj.setAttribute('dataCardType', card.Type);
    
    // Discard pile or the player
    if(player == null || player.SocketID == socketId) {

        // Get card image from sprite sheet
        const offsetX = 2 + 1680 - cdWidth * (card.ID % 14);
        const offsetY = 1440 - cdHeight * Math.floor(card.ID / 14);
        cardObj.style.backgroundImage = 'url(' + cards.src + ')';
        cardObj.style.backgroundPosition = `${offsetX}px ${offsetY}px`;

        if(player != null) {
            // Make the card clickable if it's for the player
            cardObj.addEventListener('click', () => playCard(card, player));

            // Bump cards up on the screen when they're hovered over
            cardObj.addEventListener('mouseenter', function () {
                cardObj.style.transform = 'scale(0.6) translateY(-50px)';
            });

            cardObj.addEventListener('mouseleave', function () {
                cardObj.style.transform = 'scale(0.6) translateY(0)';
            });
        }
    } else {
        // Display back of card for opponent cards
        cardObj.style.backgroundImage = 'url(' + back.src + ')';
        cardObj.style.backgroundSize = '100%';
    }

    return cardObj;
}

// Adjust card positioning as new cards get added to a hand
function repositionCards(player) {
    const hand = document.getElementById('hand_' + player.PlayerID);
    if (!hand) return;

    const cards = Array.from(hand.children);
    const cardCount = cards.length;

    if(player.SocketID == socketId) {
        // Sort based on color and type
        cards.sort((a, b) => {
            const colorDiff = a.getAttribute('dataCardColor').localeCompare(b.getAttribute('dataCardColor'));
            if (colorDiff !== 0) return colorDiff;
            return a.getAttribute('dataCardType').localeCompare(b.getAttribute('dataCardType'));
        });

        hand.innerHTML = '';

        let i = 0;
        cards.forEach(card => {
            // As more cards as drawn, overlap them more
            let marginLeft = i === 0 ? '-20' : -5 * (cardCount - 1) + 5;
            if(marginLeft < -59){marginLeft = -59;}
            card.style.marginLeft = marginLeft + 'px';
            i++;

            hand.appendChild(card);
        });
    } else {
        // For opponent hands, just append in order
        hand.innerHTML = '';
        cards.forEach((card, i) => hand.appendChild(card));
    }
}

// Update which cards are playable in the player's hand
function updatePlayableCards(topCard, currentColor) {
    const hand = document.getElementById('hand_' + playerId);
    if (!hand) return;

    const cards = hand.querySelectorAll('.card');
    const playWildDraw4Enabled = window.playWildDraw4Enabled || false;
    const mustPlaySpecific = requiredPlay.length > 0;

    let hasOtherPlayable = false;

    // First pass: check if there are any other playable cards besides Wild Draw 4
    cards.forEach(card => {
        const cardColor = card.getAttribute('dataCardColor');
        const cardType = card.getAttribute('dataCardType');

        if (!mustPlaySpecific && cardType !== 'draw4') {
            if (cardColor === currentColor || cardType === topCard.Type || cardColor === 'black') {
                hasOtherPlayable = true;
            }
        }
    });

    // Second pass: mark cards as playable or unplayable
    cards.forEach(card => {
        const cardColor = card.getAttribute('dataCardColor');
        const cardType = card.getAttribute('dataCardType');

        let playable = false;

        if (mustPlaySpecific) {
            playable = requiredPlay.includes(cardType) && (cardColor === currentColor || cardColor === 'black' || cardType === topCard.Type);
        } else {
            if (cardColor === currentColor) playable = true;
            if (cardType === topCard.Type) playable = true;

            if (cardColor === 'black') {
                if (cardType === 'wild') playable = true;
                if (cardType === 'draw4') {
                    playable = playWildDraw4Enabled || !hasOtherPlayable;
                }
            }
        }

        if (playable) {
            card.classList.remove('unplayable');
        } else {
            card.classList.add('unplayable');
        }
    });
}

// Attempt to play a card
function playCard(card, player) {
    socket.emit('playCard', card);

    repositionCards(player);
}

// Update the discard pile when a card is played
socket.on('discardCard', function(card, player) {
    currentColor = card.Color;

    // Add a card to the discard pile
    let cardObj = getCardUI(card);
    cardObj.id = 'discard';

    // Ignore the initial discard after a new deal and only handle player discards
    if(player != null) {
        document.getElementById('card_' + card.ID).remove();
        repositionCards(player);
    }

    let discard = document.getElementById('discard');
    discard.parentNode.replaceChild(cardObj, discard);
});

// Play sound when a card is drawn
socket.on('cardDrawn', function() {
    playSound('audio/draw-card.wav');
});

// Save a cookie with the player name
function setCookie(name, value, seconds) {
    let date = new Date();
    date.setTime(date.getTime() + (seconds * 1000));
    let expires = "expires=" + date.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

// Get the player name from a cookie if it exists
function getCookie(name) {
    name += "=";
    let cookies = document.cookie.split(';');
    for(let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i];
        while(cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1);
        }
        if(cookie.indexOf(name) === 0) {
            return cookie.substring(name.length, cookie.length);
        }
    }
    return null;
}

// Start a new match
function resetGame() {
    socket.emit('resetGame');
}

// Deal a new hand within the same match
function newHand() {
    socket.emit('newHand');
}

// Set a new color after a color button has been clicked after a wild
function setColor(color) {
    document.getElementById('color-buttons').style.display="none";
    socket.emit('colorChosen', color);
}

// Display all players around the table
function createPlayersUI(players) {
    for (let i = 0; i < 7;  i++) {
        document.getElementById('player' + i).innerHTML = '';
    }
    document.getElementById('playerSelf').innerHTML = '';

    for(let i = 0; i < players.length; i++) {
        let div_player = document.createElement('div');
        let div_player_name = document.createElement('div');
        let div_hand = document.createElement('div');
        let div_points = document.createElement('div');

        if(isPlayerA) {
            div_player_name.style.cursor = 'pointer';
            div_player_name.addEventListener('click', () => showBootModal(players[i].SocketID, players[i].Name));
        }

        div_player_name.className = 'name';
        div_points.className = 'points';
        div_points.id = 'points_' + players[i].PlayerID;
        div_player.className = 'player';
        div_player.id = 'player_' + players[i].PlayerID;
        div_hand.className = 'hand';
        div_hand.id = 'hand_' + players[i].PlayerID;

        div_player_name.innerHTML = players[i].Name;
        div_points.innerHTML = 'Points: ' + players[i].Points;
        div_player.appendChild(div_hand);
        div_player.appendChild(div_player_name);
        div_player.appendChild(div_points);

        if(players[i].SocketID == socketId) {
            // Add the player to the bottom of the screen
            document.getElementById('playerSelf').appendChild(div_player);
        } else {
            // Add opponents to spots around the table based on player order in the game
            let player_location = playerId - players[i].PlayerID;

            if(player_location < 0) {
                player_location += 8;
            }

            switch(player_location) {
                case 1:
                    player_location = 5;
                    break;
                case 2:
                    player_location = 3;
                    break;
                case 3:
                    player_location = 0;
                    break;
                case 4:
                    player_location = 1;
                    break;
                case 5:
                    player_location = 2;
                    break;
                case 6:
                    player_location = 4;
                    break;
                case 7:
                    player_location = 6;
                    break;
            }

            document.getElementById('player' + player_location).appendChild(div_player);
        }
    }
}

// Call Uno for oneself
function unoMe() {
    const btn = document.getElementById('btnUnoMe');
    if (btn) {
        btn.disabled = true;
        btn.style.background = 'gray';
    }

    socket.emit('unoMe');
}

// Call Uno on another player
function unoYou() {
    const btn = document.getElementById('btnUnoYou');
    if (btn) {
        btn.disabled = true;
        btn.style.background = 'gray';
    }
    
    socket.emit('unoYou');
}

// Show the game options
function showOptions() {
    document.getElementById('options').style.display = 'flex';
}

// Save the game options
function saveOptions() {
    document.getElementById('options').style.display = 'none';
    let checkboxes = document.querySelectorAll('#options input[type="checkbox"]:checked');
    let selectedValues = Array.from(checkboxes).map(checkbox => checkbox.value);

    socket.emit('saveOptions', {options: selectedValues});
}

// Initialize the game
function init() {
    cards.src = 'images/deck_full.png';
    back.src = 'images/quno.png';
  
    // Get the player name
    playerName = getCookie('playerName');
    if(playerName == null) {
        // Default autogenerated name
        let defaultName = 'Player' + Math.floor(1000 + Math.random() * 9000);

        // Prompt player for a new name
        playerName = prompt('Enter your name: ', defaultName);

        if (playerName === null || playerName === "") {
            playerName = defaultName;
        } else {
            // Save the name in a cookie
            setCookie('playerName', playerName, 24 * 3600);
        }
    }
  
    // Connect to the server
    socket.connect();
}

// Show the boot confirmation modal
function showBootModal(playerName) {
    const modal = document.getElementById('bootModal');
    const msg = document.getElementById('bootMessage');
    const confirmBtn = document.getElementById('confirmBoot');
    const cancelBtn = document.getElementById('cancelBoot');

    msg.textContent = `Are you sure you want to boot ${playerName}?`;
    modal.style.display = 'flex';

    confirmBtn.onclick = () => {
        socket.emit('bootPlayer', playerName);
        modal.style.display = 'none';
    };

    cancelBtn.onclick = () => {
        modal.style.display = 'none';
    };
}

// Play a sound effect
function playSound(src, volume=1.0) {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.play();
}

// Get the top card on the discard pile
function getTopCard() {
    const discard = document.getElementById('discard');
    return {
        Color: discard.getAttribute('dataCardColor'),
        Type: discard.getAttribute('dataCardType')
    };
}

// Handle being booted from the game
socket.on('booted', () => {
    socket.io.opts.reconnection = false; // stop Socket.IO from auto-reconnecting
    socket.disconnect(); // force disconnection from server

    // Replace page content so they can’t keep playing
    document.body.innerHTML = `
        <div style="text-align:center; margin-top:100px;">
            <h1>You have been booted from the game.</h1>
            <p>Refresh to return to the lobby.</p>
        </div>
    `;
});

// Show end-of-hand summary
socket.on('handSummary', function(summary) {
    const modal = document.getElementById('handSummaryModal');
    const content = document.getElementById('handSummaryContent');

    let html = `
        <h2>Hand Summary</h2>
        <p><strong>Winner: </strong>${summary.winner}</p>
        <p><strong>Points This Hand: </strong>${summary.pointsThisHand}</p>
        <hr>
        <h3>Points Earned From:</h3>
        <ul>
    `;

    summary.breakdown.forEach(b => {
        html += `<li>${b.name}: ${b.points}</li>`;
    });

    html += `
        </ul><hr>
        <h3>Standings:</h3>
        <ol>
    `;

    summary.standings.forEach(s => {
        html += `<li>${s.name}: ${s.points}</li>`;
    });

    html += `</ol>`;

    content.innerHTML = html;
    modal.style.display = 'flex';
});

// Close the hand summary modal
function closeHandSummary() {
    document.getElementById('handSummaryModal').style.display = 'none';
}


init();
