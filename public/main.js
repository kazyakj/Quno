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
let gameInProgress = false;
let isDrawing = false;

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

// Rebuild the full game state when rejoining after a disconnect
socket.on('rejoinState', function(state) {
    socketId = state.mySocketId;
    gameInProgress = !state.gameIsOver;
    isPlayerA = state.isHost;
    currentColor = state.currentColor;
    requiredPlay = state.requiredPlay || [];

    for (let p of state.playerList) {
        if (p.SocketID === socketId) {
            playerId = p.PlayerID;
            break;
        }
    }

    document.getElementById('waitingOverlay').style.display = 'none';
    document.getElementById('status').style.display = 'none';
    document.getElementById('uno-buttons').style.display = 'flex';
    document.getElementById('discard').style.display = 'inline-block';
    document.getElementById('color-buttons').style.display = 'none';

    if (isPlayerA) {
        document.getElementById('btnStart').style.display="inline-block";
        document.getElementById('btnOptions').style.display="inline-block";
        if (state.gameIsOver) {
            document.getElementById('btnDeal').style.display="inline-block";
        }
    }

    createPlayersUI(state.playerList);

    // Update the player list header at the top
    playersInLobby = state.playersInLobby;
    const playerListDiv = document.getElementById('playerList');
    playerListDiv.innerHTML = "<strong>Players:</strong>&nbsp;";
    state.playersInLobby.forEach(name => {
        const span = document.createElement('span');
        span.style.marginRight = '10px';
        const isHost = (name === state.hostName);
        span.innerHTML = isHost ? `<span class="crown">👑</span>${name}` : name;
        playerListDiv.appendChild(span);
    });

    for (let player of state.playerList) {
        for (let card of player.Hand) {
            let hand = document.getElementById('hand_' + player.PlayerID);
            if (!hand) continue;
            let cardObj = getCardUI(card, player);
            cardObj.classList.add('unplayable');
            hand.appendChild(cardObj);
        }
        repositionCards(player);
    }

    if (state.topCard) {
        let cardObj = getCardUI(state.topCard);
        cardObj.id = 'discard';
        let discard = document.getElementById('discard');
        discard.parentNode.replaceChild(cardObj, discard);
        updateColorBar(state.currentColor || null);
    }

    if (state.currentPlayerId >= 0) {
        document.querySelectorAll('.player').forEach(p => p.classList.remove('active'));
        const activeEl = document.getElementById('player_' + state.currentPlayerId);
        if (activeEl) activeEl.classList.add('active');

        if (state.currentPlayerId == playerId) {
            const topCard = getTopCard();
            updatePlayableCards(topCard, state.currentColor);
        }
    }

    window.playWildDraw4Enabled = state.playWildDraw4;
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
    gameInProgress = true;

    playSound('audio/game-start.wav', 0.2);

    // Show/hide elements for in-game state
    document.getElementById("status").style.display="none";
    document.getElementById('btnDeal').style.display="none";
    document.getElementById('uno-buttons').style.display="flex";
    document.getElementById('discard').style.display="inline-block";
    document.getElementById('color-buttons').style.display="none";

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
    if (gameInProgress) return;

    const overlay = document.getElementById('waitingOverlay');
    if (!isPlayerA) {
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

// Remove a player's in-game panel when they leave without rejoining
socket.on('playerLeft', function({ playerId: leftPlayerId }) {
    const panel = document.getElementById('player_' + leftPlayerId);
    if (panel) panel.remove();
});

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
    updateColorBar(color);
});

// Hide the color bar after move past a wild
socket.on('hideColor', function() {
    updateColorBar(null);
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
socket.on('updateScore', function(player, points, handsWon) {
    document.getElementById('points_' + player).innerHTML = 'Points: ' + points;
    document.getElementById('handsWon_' + player).innerHTML = 'Hands Won: ' + handsWon;
});

// Handle game over
socket.on('gameOver', function(playerName) {
    playSound('audio/game-over.wav');
    gameInProgress = false;

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

    if(!isDrawing && player.SocketID == socketId) {
        const myTurn = document.getElementById('player_' + playerId).classList.contains('active');
        if (myTurn) {
            const topCard = getTopCard();
            const activeColor = currentColor || topCard.Color;
            updatePlayableCards(topCard, activeColor);
        }
    }
});

// Render a face-down card in an opponent's hand
socket.on('renderOpponentCard', function(playerID) {
    if (playerID == playerId) return;
    
    const hand = document.getElementById('hand_' + playerID);
    if (!hand) return;

    // Build a blank opponent card object just to get the card-back rendered
    const cardObj = getCardUI({}, { SocketID: null });
    hand.appendChild(cardObj);

    // repositionCards expects a player object with SocketID and PlayerID
    repositionCards({ SocketID: null, PlayerID: playerID });
});

socket.on('drawStart', function() {
    isDrawing = true;
    const hand = document.getElementById('hand_' + playerId);
    if (hand) hand.querySelectorAll('.card').forEach(c => c.classList.add('unplayable'));
});

socket.on('drawEnd', function() {
    isDrawing = false;
    const myTurn = document.getElementById('player_' + playerId).classList.contains('active');  
    if (myTurn) {
        const topCard = getTopCard();
        updatePlayableCards(topCard, currentColor);
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

// Returns an SVG pattern overlay element for a given card color
function getColorPatternSVG(color) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;border-radius:13px;overflow:hidden;';

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const patternEl = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    const patternId = 'cbp_' + color + '_' + Math.random().toString(36).substr(2, 7);
    patternEl.setAttribute("id", patternId);
    patternEl.setAttribute("patternUnits", "userSpaceOnUse");

    const patternColor = 'rgba(255,255,255,0.45)';

    if (color === 'red') {
        // Horizontal stripes
        patternEl.setAttribute("width", "9");
        patternEl.setAttribute("height", "9");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "0"); line.setAttribute("y1", "5");
        line.setAttribute("x2", "9"); line.setAttribute("y2", "5");
        line.setAttribute("stroke", patternColor); line.setAttribute("stroke-width", "5");
        patternEl.appendChild(line);
    } else if (color === 'green') {
        // Dots
        patternEl.setAttribute("width", "9");
        patternEl.setAttribute("height", "9");
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "6"); circle.setAttribute("cy", "6"); circle.setAttribute("r", "4");
        circle.setAttribute("fill", patternColor);
        patternEl.appendChild(circle);
    } else if (color === 'blue') {
        // Diagonal lines
        patternEl.setAttribute("width", "12");
        patternEl.setAttribute("height", "12");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "0"); line.setAttribute("y1", "12");
        line.setAttribute("x2", "12"); line.setAttribute("y2", "0");
        line.setAttribute("stroke", patternColor); line.setAttribute("stroke-width", "3");
        patternEl.appendChild(line);
    } else {
        return null; // No pattern for black cards
    }

    defs.appendChild(patternEl);
    svg.appendChild(defs);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", `url(#${patternId})`);
    svg.appendChild(rect);

    return svg;
}

// Apply pattern + text label to the color bar
function updateColorBar(color) {
    const bar = document.getElementById('color-bar');
    if (!color || color === 'rgb(184, 184, 184)') {
        bar.style.background = 'rgb(184, 184, 184)';
        bar.innerHTML = '';
        return;
    }

    const colorNames = { red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow' };
    const label = colorNames[color] || color;
    const textColor = (color === 'yellow') ? '#5a3a00' : 'white';

    bar.style.background = color;
    bar.style.position = 'relative';
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'center';

    // Clear old content and rebuild
    bar.innerHTML = '';

    const svgOverlay = getColorPatternSVG(color);
    if (svgOverlay) {
        svgOverlay.style.borderRadius = '0';
        bar.appendChild(svgOverlay);
    }

    const span = document.createElement('span');
    span.textContent = label;
    span.style.cssText = `position:relative;z-index:1;font-size:11px;font-weight:bold;color:${textColor};letter-spacing:0.05em;`;
    bar.appendChild(span);
}

// Create the UI element for a card
function getCardUI(card, player) {
    let cardObj = document.createElement('div');
    cardObj.className = 'card';

    const isMyCard = (player == null || player.SocketID == socketId);
    
    // Discard pile or the player
    if(isMyCard) {
        // Only set revealing attributes on your own cards / discard
        cardObj.id = 'card_' + card.ID;
        cardObj.setAttribute('dataCardColor', card.Color);
        cardObj.setAttribute('dataCardType', card.Type);

        // Get card image from sprite sheet
        const offsetX = 2 + 1680 - cdWidth * (card.ID % 14);
        const offsetY = 1440 - cdHeight * Math.floor(card.ID / 14);
        cardObj.style.backgroundImage = 'url(' + cards.src + ')';
        cardObj.style.backgroundPosition = `${offsetX}px ${offsetY}px`;

        // Inject colorblind pattern overlay
        cardObj.style.position = 'relative';
        const patternOverlay = getColorPatternSVG(card.Color);
        if (patternOverlay) cardObj.appendChild(patternOverlay);

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
    if (isDrawing) return;

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
        const playedCardEl = document.getElementById('card_' + card.ID);
        if (playedCardEl) playedCardEl.remove();
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
        let div_hands_won = document.createElement('div');

        if(isPlayerA) {
            div_player_name.style.cursor = 'pointer';
            div_player_name.addEventListener('click', () => showBootModal(players[i].SocketID, players[i].Name));
        }

        div_player_name.className = 'name';
        div_points.className = 'points';
        div_points.id = 'points_' + players[i].PlayerID;
        div_hands_won.className = 'hands-won';
        div_hands_won.id = 'handsWon_' + players[i].PlayerID;
        div_player.className = 'player';
        div_player.id = 'player_' + players[i].PlayerID;
        div_hand.className = 'hand';
        div_hand.id = 'hand_' + players[i].PlayerID;

        div_player_name.innerHTML = players[i].Name;
        div_points.innerHTML = 'Points: ' + players[i].Points;
        div_hands_won.innerHTML = 'Hands Won: ' + players[i].HandsWon;
        div_player.appendChild(div_player_name);
        div_player.appendChild(div_hand);
        div_player.appendChild(div_points);
        div_player.appendChild(div_hands_won);
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

    playerName = playerName.substring(0, 29);
  
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

    const ps = summary.playerStats || [];

    // Build per-player turn time rows for hand
    const handTurnRows = ps.map(p =>
        `<tr>
            <td style="padding:6px 8px;font-size:14px;">${p.name}</td>
            <td style="text-align:right;padding:6px 8px;font-size:14px;">${p.handCardsPlayed}</td>
            <td style="text-align:right;padding:6px 8px;font-size:14px;">${formatDuration(p.handTurnTime)}</td>
        </tr>`
    ).join('');

    // Build per-player standings rows for match
    const standingRows = ps
        .slice()
        .sort((a, b) => b.pointsScored - a.pointsScored)
        .map(p => {
            const netColor = p.netPoints >= 0 ? 'color:#2a7a2a;font-weight:600;' : 'color:#b33;font-weight:600;';
            const netStr = (p.netPoints >= 0 ? '+' : '') + p.netPoints;
            return `<tr>
                <td style="padding:6px 8px;font-size:14px;font-weight:600;">${p.name}</td>
                <td style="text-align:right;padding:6px 8px;font-size:14px;">${p.pointsScored}</td>
                <td style="text-align:right;padding:6px 8px;font-size:14px;">${p.pointsGivenUp}</td>
                <td style="text-align:right;padding:6px 8px;font-size:14px;${netColor}">${netStr}</td>
            </tr>`;
        }).join('');

    // Build per-player match turn time rows
    const matchTurnRows = ps.map(p =>
        `<tr>
            <td style="padding:6px 8px;font-size:14px;">${p.name}</td>
            <td style="text-align:right;padding:6px 8px;font-size:14px;">${p.matchCardsPlayed}</td>
            <td style="text-align:right;padding:6px 8px;font-size:14px;">${formatDuration(p.matchTurnTime)}</td>
        </tr>`
    ).join('');

    const thStyle = 'text-align:left;padding:7px 8px;font-size:13px;color:#555;font-weight:600;border-bottom:2px solid #ddd;';
    const thRight = 'text-align:right;padding:7px 8px;font-size:13px;color:#555;font-weight:600;border-bottom:2px solid #ddd;';
    const tdStyle = 'padding:6px 8px;font-size:14px;';
    const tdRight = 'text-align:right;padding:6px 8px;font-size:14px;';

    const html = `
        <h2 style="text-align:center;font-size:20px;font-weight:700;margin:0 0 18px;">Hand summary</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

            <!-- LEFT: HAND STATS -->
            <div>
                <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#777;margin:0 0 12px;">This hand</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Winner</div>
                        <div style="font-size:15px;font-weight:700;">${summary.winner}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Points scored</div>
                        <div style="font-size:15px;font-weight:700;">${summary.pointsThisHand}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Duration</div>
                        <div style="font-size:15px;font-weight:700;">${formatDuration(summary.handDuration)}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Cards played</div>
                        <div style="font-size:15px;font-weight:700;">${summary.handCardsPlayed}</div>
                    </div>
                </div>

                <p style="font-size:12px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Points given up</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Points</th>
                    </tr></thead>
                    <tbody>
                        ${summary.breakdown.map(b => `<tr><td style="${tdStyle}">${b.name}</td><td style="${tdRight}">${b.points}</td></tr>`).join('')}
                        <tr><td style="padding:6px 8px;font-size:14px;color:transparent;">—</td><td></td></tr>
                    </tbody>
                </table>

                <p style="font-size:12px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Time spent playing (this hand)</p>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Cards Played</th>
                        <th style="${thRight}">Time Taken</th>
                    </tr></thead>
                    <tbody>${handTurnRows}</tbody>
                </table>
            </div>

            <!-- RIGHT: MATCH STATS -->
            <div style="border-left:1px solid #e0e0e0;padding-left:20px;">
                <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#777;margin:0 0 12px;">Match so far</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Duration</div>
                        <div style="font-size:15px;font-weight:700;">${formatDuration(summary.matchDuration)}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Hands played</div>
                        <div style="font-size:15px;font-weight:700;">${summary.handsPlayed}</div>
                    </div>
                    <div style="background:#f5f5f5;border-radius:8px;padding:12px 14px;grid-column:1/-1;">
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">Cards played</div>
                        <div style="font-size:15px;font-weight:700;">${summary.matchCardsPlayed.toLocaleString()}</div>
                    </div>
                </div>

                <p style="font-size:12px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Standings</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Scored</th>
                        <th style="${thRight}">Given up</th>
                        <th style="${thRight}">Net</th>
                    </tr></thead>
                    <tbody>${standingRows}</tbody>
                </table>

                <p style="font-size:12px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Time spent playing (match total)</p>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Cards Played</th>
                        <th style="${thRight}">Time Taken</th>
                    </tr></thead>
                    <tbody>${matchTurnRows}</tbody>
                </table>
            </div>
        </div>
    `;

    content.innerHTML = html;
    modal.style.display = 'flex';
});

// Format a duration in seconds into a human-readable string
function formatDuration(totalSeconds) {
    const seconds = Number(totalSeconds);

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);

    return [
        hours ? `${hours}h` : null,
        minutes ? `${minutes}m` : null,
        secs || (!hours && !minutes) ? `${secs}s` : null
    ]
        .filter(Boolean)
        .join(' ');
}

// Close the hand summary modal
function closeHandSummary() {
    document.getElementById('handSummaryModal').style.display = 'none';
}


init();
