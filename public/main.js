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

// --- UI Helpers ---

function show(id, displayType = 'block') {
    document.getElementById(id).style.display = displayType;
}

function hide(id) {
    document.getElementById(id).style.display = 'none';
}

function renderPlayerList(lobbyPlayers, hostName) {
    const playerListDiv = document.getElementById('playerList');
    playerListDiv.innerHTML = "<strong>Players:</strong>&nbsp;";

    lobbyPlayers.forEach(name => {
        const span = document.createElement('span');
        span.style.marginRight = '10px';
        const isHost = (name === hostName);
        span.innerHTML = isHost ? `<span class="crown">👑</span>${name}` : name;

        if (isPlayerA) {
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
}

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

    hide('waitingOverlay');
    hide('status');
    show('uno-buttons', 'flex');
    show('discard', 'inline-block');
    hide('color-buttons');

    if (isPlayerA) {
        show('btnStart', 'inline-block');
        show('btnOptions', 'inline-block');
        if (state.gameIsOver) {
            show('btnDeal', 'inline-block');
        }
    }

    createPlayersUI(state.playerList);

    // Update the player list header at the top
    playersInLobby = state.playersInLobby;
    renderPlayerList(state.playersInLobby, state.hostName);

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
socket.on('isPlayerA', function(data) {
    isPlayerA = true;
    hide('waitingOverlay');
    show('btnStart', 'inline-block');
    show('btnOptions', 'inline-block');
    // If we were promoted mid-game and the hand is already over, also show Deal
    if (data && data.gameInProgress === false && gameInProgress === false) {
        show('btnDeal', 'inline-block');
    }
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

    // Sync all checkboxes to the current server-side option state
    const optionMap = {
        playWildDraw4: 'playWildDraw4',
        stackDraw2:    'stackDraw2',
        skipDraw2:     'skipDraw2',
        reverseDraw2:  'reverseDraw2',
        stackDraw4:    'stackDraw4',
        skipDraw4:     'skipDraw4',
        reverseDraw4:  'reverseDraw4',
    };
    for (const [key, name] of Object.entries(optionMap)) {
        const cb = document.querySelector(`input[name="${name}"]`);
        if (cb) cb.checked = !!options[key];
    }
    // Sync the Matt Mode master checkbox: checked only if all sub-options are on
    const controlled = document.querySelectorAll('.controlledCheckbox');
    const master = document.getElementById('masterCheckbox');
    if (master && controlled.length) {
        master.checked = Array.from(controlled).every(cb => cb.checked);
    }
});

// Start the game
socket.on('gameStarted', function(playerList) {
    players = playerList.length;
    hide('waitingOverlay');
    gameInProgress = true;

    playSound('audio/game-start.wav', 0.2);

    // Show/hide elements for in-game state
    hide('status');
    hide('btnDeal');
    show('uno-buttons', 'flex');
    show('discard', 'inline-block');
    hide('color-buttons');

    // Get this player's ID
    const self = playerList.find(p => p.SocketID === socketId);
    if (self) playerId = self.PlayerID;

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

    playersInLobby = lobbyPlayers;
    renderPlayerList(lobbyPlayers, hostName);

    if (isPlayerA) {
        updateStartButtonState();
    } else {
        updateWaitingOverlay();
    }
});

// Display the buttons to let the player pick a color after a wild is played
socket.on('chooseColor', function() {
    show('color-buttons', 'flex');

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

function setUnoButtonState(btnId, called) {
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.disabled = called;
        btn.style.background = called ? 'gray' : '#222';
    }
}

socket.on('calledUnoMe',    () => setUnoButtonState('btnUnoMe', true));
socket.on('notCalledUnoMe', () => setUnoButtonState('btnUnoMe', false));
socket.on('calledUnoYou',   () => setUnoButtonState('btnUnoYou', true));
socket.on('notCalledUnoYou',() => setUnoButtonState('btnUnoYou', false));

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
    show('status', 'inline-block');

    if(isPlayerA) {
        show('btnDeal', 'inline-block');
    }
});

// Render a card in a player's hand
socket.on('renderCard', function(card, player) {
    let hand = document.getElementById('hand_' + player.PlayerID);

    animateCardDraw(hand, true, () => {
        let cardObj = getCardUI(card, player);
        cardObj.classList.add('unplayable');
        // Start invisible and fade in
        cardObj.style.opacity = '0';
        cardObj.style.transition = 'opacity 0.15s ease';
        hand.appendChild(cardObj);
        repositionCards(player);
        requestAnimationFrame(() => requestAnimationFrame(() => { cardObj.style.opacity = '1'; }));

        if(!isDrawing && player.SocketID == socketId) {
            const myTurn = document.getElementById('player_' + playerId).classList.contains('active');
            if (myTurn) {
                const topCard = getTopCard();
                const activeColor = currentColor || topCard.Color;
                updatePlayableCards(topCard, activeColor);
            }
        }
    });
});

// Render a face-down card in an opponent's hand
socket.on('renderOpponentCard', function(playerID) {
    if (playerID == playerId) return;
    
    const hand = document.getElementById('hand_' + playerID);
    if (!hand) return;

    animateCardDraw(hand, false, () => {
        const cardObj = getCardUI({}, { SocketID: null });
        cardObj.style.opacity = '0';
        cardObj.style.transition = 'opacity 0.15s ease';
        hand.appendChild(cardObj);
        repositionCards({ SocketID: null, PlayerID: playerID });
        requestAnimationFrame(() => requestAnimationFrame(() => { cardObj.style.opacity = '1'; }));
    });
});

// Remove one face-down card from an opponent's hand when they play a card
socket.on('removeOpponentCard', function(playerID) {
    if (playerID == playerId) return;

    const hand = document.getElementById('hand_' + playerID);
    if (!hand) return;

    // Remove the last card-back (opponents' hands only contain card-backs)
    const lastCard = hand.lastElementChild;
    if (lastCard) lastCard.remove();

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

// Animate a card flying from a source element to the discard pile.
// Fire-and-forget: all game state changes happen synchronously before calling
// this; the animation is purely cosmetic and nothing waits on it.
// srcRect must be captured BEFORE the source element is removed from the DOM.
function animateCardPlay(sourceEl, srcRect) {
    const discard = document.getElementById('discard');
    if (!sourceEl || !srcRect || !discard) return;

    const dstRect = discard.getBoundingClientRect();

    // Clone at full logical size (cdWidth x cdHeight) and use transform: scale()
    // to match the visual size. This keeps background-position identical to the
    // original element throughout the flight — no sprite drift possible.
    const flying = document.createElement('div');
    flying.className = 'card';
    flying.style.backgroundImage = sourceEl.style.backgroundImage;
    flying.style.backgroundPosition = sourceEl.style.backgroundPosition;
    flying.style.backgroundSize = sourceEl.style.backgroundSize || 'auto';
    flying.style.position = 'fixed';
    flying.style.width = cdWidth + 'px';
    flying.style.height = cdHeight + 'px';
    flying.style.borderRadius = '15px';
    flying.style.pointerEvents = 'none';
    flying.style.zIndex = '9999';
    flying.style.margin = '0';
    flying.style.boxShadow = '2px 6px 16px rgba(0,0,0,0.45)';
    flying.style.transformOrigin = 'top left';
    flying.style.transition = 'none';

    const srcScale = srcRect.width / cdWidth;
    const dstScale = dstRect.width / cdWidth;

    const startX = srcRect.left + srcRect.width / 2 - (cdWidth * srcScale) / 2;
    const startY = srcRect.top + srcRect.height / 2 - (cdHeight * srcScale) / 2;
    const endX   = dstRect.left + dstRect.width / 2 - (cdWidth * dstScale) / 2;
    const endY   = dstRect.top + dstRect.height / 2 - (cdHeight * dstScale) / 2;

    flying.style.left = startX + 'px';
    flying.style.top  = startY + 'px';
    flying.style.transform = `scale(${srcScale})`;
    document.body.appendChild(flying);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flying.style.transition = 'left 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), ' +
                                      'top 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), ' +
                                      'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            flying.style.left = endX + 'px';
            flying.style.top  = endY + 'px';
            flying.style.transform = `scale(${dstScale})`;
        });
    });

    flying.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'top') return;
        flying.removeEventListener('transitionend', handler);
        flying.remove();
    });
}

// Animate a card flying from the draw pile to a target hand element
function animateCardDraw(targetHandEl, isOwn, onComplete) {
    const pile = document.querySelector('.playArea1 .pile');
    if (!pile) { onComplete(); return; }

    const pileRect = pile.getBoundingClientRect();
    const handRect = targetHandEl.getBoundingClientRect();

    // Create a flying card clone (always shows card back)
    const flying = document.createElement('div');
    flying.style.cssText = `
        position: fixed;
        width: ${cdWidth * 0.6}px;
        height: ${cdHeight * 0.6}px;
        border-radius: 9px;
        background-image: url(${back.src});
        background-size: 100%;
        pointer-events: none;
        z-index: 9999;
        left: ${pileRect.left + pileRect.width / 2 - (cdWidth * 0.6) / 2}px;
        top: ${pileRect.top + pileRect.height / 2 - (cdHeight * 0.6) / 2}px;
        transition: left 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    top 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    opacity 0.1s ease 0.22s;
        box-shadow: 2px 4px 12px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(flying);

    // Destination: center of the target hand
    const destX = handRect.left + handRect.width / 2 - (cdWidth * 0.6) / 2;
    const destY = handRect.top + handRect.height / 2 - (cdHeight * 0.6) / 2;

    // Trigger animation on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flying.style.left = destX + 'px';
            flying.style.top = destY + 'px';
            flying.style.opacity = '0';
        });
    });

    flying.addEventListener('transitionend', function handler(e) {
        if (e.propertyName !== 'top') return;
        flying.removeEventListener('transitionend', handler);
        flying.remove();
        onComplete();
    });
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

        cards.forEach((card, i) => {
            // As more cards as drawn, overlap them more
            let marginLeft = i === 0 ? '-20' : -5 * (cardCount - 1) + 5;
            if(marginLeft < -59) marginLeft = -59;
            card.style.marginLeft = marginLeft + 'px';
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

    let cardObj = getCardUI(card);
    cardObj.id = 'discard';

    // Initial deal — no animation, just swap immediately
    if (player == null) {
        let discard = document.getElementById('discard');
        discard.parentNode.replaceChild(cardObj, discard);
        return;
    }

    const isMyCard = player.SocketID === socketId;

    if (isMyCard) {
        // Snapshot rect while element is still in the DOM, then do all state
        // changes synchronously so turnChange/updatePlayableCards see correct state.
        const sourceEl = document.getElementById('card_' + card.ID);
        const srcRect = sourceEl ? sourceEl.getBoundingClientRect() : null;
        if (sourceEl) sourceEl.remove();
        repositionCards(player);

        // Swap the discard immediately — turnChange reads getTopCard() from this
        let discard = document.getElementById('discard');
        discard.parentNode.replaceChild(cardObj, discard);

        // Animation is purely cosmetic, fires after all state is already correct
        animateCardPlay(sourceEl, srcRect);
    } else {
        // Opponent: removeOpponentCard handles DOM removal and repositionCards.
        // Snapshot for animation before it's removed.
        const hand = document.getElementById('hand_' + player.PlayerID);
        const sourceEl = hand ? hand.lastElementChild : null;
        const srcRect = sourceEl ? sourceEl.getBoundingClientRect() : null;

        let discard = document.getElementById('discard');
        discard.parentNode.replaceChild(cardObj, discard);

        animateCardPlay(sourceEl, srcRect);
    }
});

// Play sound when a card is drawn
socket.on('cardDrawn', function() {
    playSound('audio/draw-card.wav');
});

// Save the player name for next visit
function savePlayerName(name) {
    localStorage.setItem('playerName', name);
}

// Get the player name from local storage if it exists
function getSavedPlayerName() {
    return localStorage.getItem('playerName');
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
    hide('color-buttons');
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

            const locationMap = [null, 5, 4, 3, 2, 1, 0, 6]; // Maps player_location to player div id
            player_location = locationMap[player_location];

            document.getElementById('player' + player_location).appendChild(div_player);
        }
    }
}

// Call Uno for oneself or another player
function unoCall(type) {
    setUnoButtonState('btnUno' + type, true);
    socket.emit('uno' + type);
}

function unoMe() { unoCall('Me'); }
function unoYou() { unoCall('You'); }

// Toggle the game options panel
function showOptions() {
    const options = document.getElementById('options');
    if (options.style.display === 'flex') {
        hide('options');
    } else {
        show('options', 'flex');
    }
}

// Save the game options
function saveOptions() {
    hide('options');
    let checkboxes = document.querySelectorAll('#options input[type="checkbox"]:checked');
    let selectedValues = Array.from(checkboxes).map(checkbox => checkbox.value);

    socket.emit('saveOptions', {options: selectedValues});
}

// Initialize the game
function init() {
    cards.src = 'images/deck_full.png';
    back.src = 'images/quno.png';
  
    // Get the player name
    playerName = getSavedPlayerName();
    if(playerName == null) {
        // Default autogenerated name
        let defaultName = 'Player' + Math.floor(1000 + Math.random() * 9000);

        // Prompt player for a new name
        playerName = prompt('Enter your name: ', defaultName);

        if (playerName === null || playerName === "") {
            playerName = defaultName;
        } else {
            // Save the name for next time
            savePlayerName(playerName);
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

    // Truncate long player names so they don't break table layout
    const MAX_NAME = 14;
    function truncate(name) {
        return name.length > MAX_NAME ? name.slice(0, MAX_NAME - 1) + '...' : name;
    }

    const thBase  = 'padding:7px 10px;font-size:11px;color:#6b8a7a;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid rgba(0,232,154,0.3);'; 
    const thStyle = 'text-align:left;' + thBase;
    const thRight = 'text-align:right;' + thBase;
    const tdStyle = 'padding:6px 8px;font-size:14px;';
    const tdRight = 'text-align:right;padding:6px 8px;font-size:14px;';

    function buildTurnRows(cardsKey, timeKey) {
        return ps.map(p =>
            `<tr>
                <td style="${tdStyle}">${truncate(p.name)}</td>
                <td style="${tdRight}">${p[cardsKey]}</td>
                <td style="${tdRight}">${formatDuration(p[timeKey])}</td>
            </tr>`
        ).join('');
    }

    // Build per-player turn time rows for hand and match
    const handTurnRows = buildTurnRows('handCardsPlayed', 'handTurnTime');
    const matchTurnRows = buildTurnRows('matchCardsPlayed', 'matchTurnTime');

    // Build per-player standings rows for match
    const standingRows = ps
        .slice()
        .sort((a, b) => (b.pointsScored - a.pointsScored) || (b.netPoints - a.netPoints))
        .map(p => {
            const netColor = p.netPoints >= 0 ? 'color:#3db87a;font-weight:600;' : 'color:#c94f5f;font-weight:600;';
            const netStr = (p.netPoints >= 0 ? '+' : '') + p.netPoints;
            return `<tr>
                <td style="${tdStyle}font-weight:600;">${truncate(p.name)}</td>
                <td style="${tdRight}">${p.pointsScored}</td>
                <td style="${tdRight}">${p.pointsGivenUp}</td>
                <td style="${tdRight}${netColor}">${netStr}</td>
            </tr>`;
        }).join('');

    const sc = 'padding:10px 0 10px;border-bottom:1px solid rgba(0,232,154,0.15);';
    const slabel = 'font-size:11px;color:#6b8a7a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;';
    const sval = 'font-size:1.15rem;font-weight:700';

    const breakdownRows = summary.breakdown.length;
    const standingsCount = ps.length;
    const paddingRows = Math.max(0, standingsCount - breakdownRows);
    const breakdownpadding = paddingRows > 0 
        ? `<tr><td colspan="2" style="padding:${paddingRows * 33}px 0 0;"></td></tr>`
        : '';

    const html = `
        <h2 style="margin:0 0 20px;text-align:center;">Hand Summary</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">

            <!-- LEFT: HAND STATS -->
            <div>
                <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b8a7a;margin:0 0 12px;">This hand</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:20px;">
                    <div style="${sc}padding-right:12px;"><div style="${slabel}">Winner</div><div style="${sval}color:#3db87a;">${truncate(summary.winner)}</div></div>
                    <div style="${sc}padding-left:12px;"><div style="${slabel}">Points scored</div><div style="${sval}">${summary.pointsThisHand}</div></div>
                    <div style="${sc}padding-right:12px;"><div style="${slabel}">Duration</div><div style="${sval}">${formatDuration(summary.handDuration)}</div></div>
                    <div style="${sc}padding-left:12px;border-bottom:none;"><div style="${slabel}">Cards played</div><div style="${sval}">${summary.handCardsPlayed}</div></div>
                </div>

                <p style="${slabel}margin:0 0 8px;">Points given up</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Points</th>
                    </tr></thead>
                    <tbody>
                        ${summary.breakdown.map(b => `<tr><td style="${tdStyle}">${b.name}</td><td style="${tdRight}">${b.points}</td></tr>`).join('')}
                        ${breakdownpadding}
                    </tbody>
                </table>

                <p style="${slabel}margin:0 0 8px;">Time spent (this hand)</p>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Cards</th>
                        <th style="${thRight}">Time</th>
                    </tr></thead>
                    <tbody>${handTurnRows}</tbody>
                </table>
            </div>

            <!-- RIGHT: MATCH STATS -->
            <div style="border-left:1px solid rgba(0,232,154,0.15);padding-left:24px;">
                <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b8a7a;margin:0 0 12px;">Match so far</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:20px;">
                    <div style="${sc}padding-right:12px;"><div style="${slabel}">Duration</div><div style="${sval}">${formatDuration(summary.matchDuration)}</div></div>
                    <div style="${sc}padding-left:12px;"><div style="${slabel}">Hands played</div><div style="${sval}">${summary.handsPlayed}</div></div>
                    <div style="${sc}padding-right:12px;border-bottom:none;grid-column:1/-1;"><div style="${slabel}">Cards played</div><div style="${sval}">${summary.matchCardsPlayed.toLocaleString()}</div></div>
                </div>

                <p style="${slabel}margin:0 0 8px;">Standings</p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Scored</th>
                        <th style="${thRight}">Given up</th>
                        <th style="${thRight}">Net</th>
                    </tr></thead>
                    <tbody>${standingRows}</tbody>
                </table>

                <p style="${slabel}margin:0 0 8px;">Time spent (match total)</p>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr>
                        <th style="${thStyle}">Player</th>
                        <th style="${thRight}">Cards</th>
                        <th style="${thRight}">Time</th>
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

// Wire up the "Matt Mode" master checkbox to toggle all sub-options
const masterCheckbox = document.getElementById('masterCheckbox');
const controlledCheckboxes = document.querySelectorAll('.controlledCheckbox');
masterCheckbox.addEventListener('click', () => {
    const isChecked = masterCheckbox.checked;
    controlledCheckboxes.forEach(checkbox => { checkbox.checked = isChecked; });
});

init();