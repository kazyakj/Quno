const { pl } = require('date-fns/locale');
const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

app.use(express.static(__dirname + '/public', { 'Content-Type': 'application/javascript' }));
io.on('connection', onConnection);
server.listen(port, () => console.log('listening on port ' + port));

const maxPlayers = 8;
const CARD_DRAW_DELAY_MS = 300;
let playDirection = -1;
let currentPlayer;
let currentColor;
let currentType;
let cardsToDraw = 0;
let discardPile = new Array();
let players = new Map();
let playersInLobby = new Array();
let hostName = null;
let deck = new Array();
let playerA = null;
let playWildDraw4 = false;
let stackDraw2 = false;
let skipDraw2 = false;
let reverseDraw2 = false;
let stackDraw4 = false;
let skipDraw4 = false;
let reverseDraw4 = false;
let gameIsOver = false;
let cardList = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'skip', 'reverse', 'draw2', 'wild', 'draw4']
let requiredPlay = new Array();


/**
 * Whenever a client connects
 * @function
 * @param {Socket} socket Client socket
 */
function onConnection(socket) {

    // Boot a player from the game
    socket.on('bootPlayer', (targetName) => {
        if(socket.id == playerA) {
            const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.playerName === targetName);
            if(targetSocket) {
                targetSocket.emit('booted');
                targetSocket.disconnect(true); // forcibly disconnect the player
                playersInLobby = playersInLobby.filter(p => p !== targetName);
                
                for (let [id, player] of players.entries()) {
                    if (player.Name === targetName) {
                        players.delete(id);
                        break;
                    }
                }
                
                io.emit('setHost', hostName);
                io.emit('newPlayer', { players: playersInLobby, host: hostName });
                io.emit('logMessage', targetName + ' was booted by the host');

                if (targetName === hostName) {
                    playerA = null;
                    hostName = null;
                }

                if (targetSocket.id == currentPlayer) {
                    nextTurn();
                }
            }
        }
    });

    // Remove a player if they leave
    socket.on('disconnect', () => {
        playersInLobby = playersInLobby.filter(player => player !== socket.playerName);
        io.emit('newPlayer', { players: playersInLobby, host: hostName });

        if(socket.id == playerA && socket.playerName === hostName) {
            const stillHere = Array.from(io.sockets.sockets.values()).some(s => s.playerName === hostName);
            if(!stillHere) {
                playerA = null;
            }
        }
    });

    /**
     * Whenever a room is requested, looks for a slot for the player,
     * up to 8 players in a room
     * @method
     * @param {String} playerName Player name
     * @return responseRoom and # of players if there's an open slot, otherwise error.
     */
    socket.on('requestJoin', function(playerName) {
        socket.playerName = playerName;

        // If there's no primary player, make the new player primary
        if(playerA == null) {
            playerA = socket.id;
            hostName = playerName;
            io.to(socket.id).emit('isPlayerA');
            io.emit('setHost', hostName);
        }

        let people;
        try {
            people = io.engine.clientsCount;
        } catch (e) {
            people = 0;
        }

        // Add the player to the game if there's enough room
        if(people < maxPlayers) {
            socket.join();
            playersInLobby.push(playerName);
            io.to(socket.id).emit('responseRoom', [people + 1, maxPlayers]);
            io.emit('newPlayer', {players: playersInLobby, host: hostName});
            io.emit('logMessage', playerName + ' joined the game');

            return;
        } else {
            // Room is full, send an error
            io.to(socket.id).emit('responseRoom', 'error');
        }
    });

    // Start a new match
    socket.on('resetGame', function() {
        let playerCount = io.engine.clientsCount;

        if(playerCount > 1) {
            io.emit('logMessage', 'A new match was started');
            createPlayers();
            startGame();
        }
    });

    // Deal a new hand without resetting the players
    socket.on('newHand', function() {
        io.emit('logMessage', 'A new hand was dealt');
        startGame();
    });

    // Play a card
    socket.on('playCard', function(card) {
        let player = players.get(socket.id);
        if (!player) return;
        if (player.WaitingForColorChoice) return;

        let playColor = card.Color;
        let playType = card.Type;

        // Only let someone play if it's their turn
        if(socket.id == currentPlayer) {

            let colorMatch = (playColor == currentColor && playColor != 'black');
            let typeMatch = (playType == currentType && playColor != 'black');
            let wild = (playType == 'wild');
            let draw4wild = false;

            if(playWildDraw4) {
                // If 'play draw 4 any time' is enabled, let them play it
                draw4wild = (playType == 'draw4');
            } else {
                // If 'play draw 4 any time' is disabled, make sure it's their only playable card first
                draw4wild = (playType == 'draw4' && !canPlay(currentPlayer, ['draw4']));
            }

            // Let them play if they have the right color or card value, or if it's a wild
            // In some scenarios, like stacking draw 2s, there's another check to see if there's a certain requirement for the next play
            if((colorMatch || typeMatch || wild || draw4wild) && (requiredPlay.length == 0 || requiredPlay.includes(playType))) {
                requiredPlay = new Array();
                io.to(currentPlayer).emit('requiredPlay', requiredPlay);
                discardCard(card, socket.id);
                io.emit('hideColor');
                io.emit('logMessage', socket.playerName + ' played a ' + playColor + ' ' + playType);

                // See if the player won after playing their card
                checkForWin(socket.id);

                if(playType == 'wild') {
                    // Wild - have the player choose a new color
                    player.WaitingForColorChoice = true; // ⬅ LOCK player actions
                    io.to(socket.id).emit('chooseColor');
                } else if(playType == 'draw4') {
                    // Wild draw 4 - queue up 4 more cards to be drawn, then have the player choose a new color
                    cardsToDraw += 4;
                    player.WaitingForColorChoice = true; // ⬅ LOCK player actions

                    requiredPlay = [];
                    if(stackDraw4) requiredPlay.push('draw4');
                    if(skipDraw4) requiredPlay.push('skip');
                    if(reverseDraw4) requiredPlay.push('reverse');
                    io.to(socket.id).emit('chooseColor');
                } else if(playType == 'skip' || (playType == 'reverse' && players.size == 2)) {
                    // Skip - jump over the next player
                    nextTurn(true);

                    // If there are cards remaining to be drawn (e.g. a skip was played on a draw 2) then draw those cards
                    if (cardsToDraw > 0) {
                        drawCards(currentPlayer, cardsToDraw);
                    }
                    requiredPlay = [];
                    io.emit('requiredPlay', requiredPlay);
                    nextTurn();
                } else if(playType == 'reverse') {
                    // Reverse - change the direction of play
                    playDirection = -playDirection;
                    nextTurn();

                    // If there are cards remaining to be drawn (e.g. a reverse was played on a draw 2) then draw those cards
                    if(cardsToDraw > 0) {
                        drawCards(currentPlayer, cardsToDraw);
                        nextTurn();
                    }
                    requiredPlay = [];
                    io.emit('requiredPlay', requiredPlay);
                } else if(playType == 'draw2') {
                    // Draw 2 - queue up 2 more cards to be drawn
                    cardsToDraw += 2;
                    nextTurn(true);

                    // Check all the game options for playing on draw 2s
                    requiredPlay = [];
                    if(stackDraw2) requiredPlay.push('draw2');
                    if(skipDraw2) requiredPlay.push('skip');
                    if(reverseDraw2) requiredPlay.push('reverse');

                    io.to(currentPlayer).emit('requiredPlay', requiredPlay);

                    // See whether the next player has any cards they can stack
                    let tempArray = cardList.filter(item => !requiredPlay.includes(item));

                    if(!canPlay(currentPlayer, tempArray)) {
                        drawCards(currentPlayer, cardsToDraw);
                        requiredPlay = [];
                        io.emit('requiredPlay', requiredPlay);
                        nextTurn();
                    }
                } else {
                    // Any numbered card - just move to the next turn
                    nextTurn();
                }
            }
        }
    });

    // Draw a card
    socket.on('drawCard', function() {
        autoDraw(socket.id);
    });

    // Advance game after a color is chosen following a wild
    socket.on('colorChosen', function(color) {
        let player = players.get(socket.id);
        if (!player) return;

        player.WaitingForColorChoice = false;

        // A new color was chosen
        currentColor = color;
        io.emit('colorChosen', color);
        io.emit('logMessage', 'The color was changed to ' + color);
        
        // For handling wild draw 4
        if(cardsToDraw > 0) {
            nextTurn(true);

            requiredPlay = [];

            // Let the player stack on a draw 4 if they can
            if(stackDraw4) requiredPlay.push('draw4');
            if(skipDraw4) requiredPlay.push('skip');
            if(reverseDraw4) requiredPlay.push('reverse');

            io.emit('requiredPlay', requiredPlay);

            let tempArray = cardList.filter(item => !requiredPlay.includes(item));

            if(!canPlay(currentPlayer, tempArray)) {
                drawCards(currentPlayer, cardsToDraw);
                requiredPlay = [];
                io.emit('requiredPlay', requiredPlay);
                nextTurn();
            }
        } else {
            nextTurn();
        }
    });

    // Player called Uno for themselves
    socket.on('unoMe', function() {
        let player = players.get(socket.id);
        if (!player) return;

        if (player.HasCalledUnoMeThisTurn) return;

        player.HasCalledUnoMeThisTurn = true;
        io.to(socket.id).emit('calledUnoMe');

        const now = Date.now();
        const GRACE_MS = 1000;

        player.LastUnoMeTime = Date.now();

        // Only let them call it if it's their turn and they have 2 cards, or if it's not their turn and they have 1 card
        if((player.Hand.length <= 2 && socket.id == currentPlayer) || player.Hand.length == 1) {
            // Valid Uno call
            if (!player.HasCalledUno) {
                io.emit('logMessage', socket.playerName + ' called Uno');
                player.HasCalledUno = true;
            }
        } else {
            // Invalid Uno call
            const recentlyGotUnoYou = player.LastUnoYouTime && (now - player.LastUnoYouTime < GRACE_MS);

            // Ignore penalty if they were just called Uno on and already penalized
            if (!recentlyGotUnoYou) {
                io.emit('logMessage', socket.playerName + ' called Uno at the wrong time - oops!');
                drawCards(socket.id, 2);
            }
        }
    });

    // Player called Uno on someone else
    socket.on('unoYou', function() {

        let caller = players.get(socket.id);
        if (!caller) return;

        if (caller.HasCalledUnoYou) return;

        caller.HasCalledUnoYou = true;
        io.to(socket.id).emit('calledUnoYou');

        const now = Date.now();
        const GRACE_MS = 1000;

        players.forEach((player) => {
            const recentlyCalledUnoMe = player.LastUnoMeTime && (now - player.LastUnoMeTime < GRACE_MS);

            // Iterate through all players and see if they have 1 card + haven't called Uno
            if(player.Hand.length == 1 && !player.HasCalledUno && !recentlyCalledUnoMe) {
                // Draw cards if they're caught
                io.emit('logMessage', player.Name + ' had Uno called on them');
                drawCards(player.SocketID, 4);
                player.LastUnoYouTime = Date.now();
            };
        });
    });

    // Save the selected game options
    socket.on('saveOptions', (data) => {
        let selectedOptions = data.options;

        playWildDraw4 = selectedOptions.includes('playWildDraw4');
        stackDraw2 = selectedOptions.includes('stackDraw2');
        skipDraw2 = selectedOptions.includes('skipDraw2');
        reverseDraw2 = selectedOptions.includes('reverseDraw2');
        stackDraw4 = selectedOptions.includes('stackDraw4');
        skipDraw4 = selectedOptions.includes('skipDraw4');
        reverseDraw4 = selectedOptions.includes('reverseDraw4');

        io.emit('updateOptions', {
            playWildDraw4
        });
    });
}

// Look up the card's color based on position in the sprite sheet
function cardColor(card) {
    let color;

    if(card % 14 === 13) {
        return 'black';
    }

    switch(Math.floor(card / 14)) {
        case 0:
        case 4:
            color = 'red';
            break;
        case 1:
        case 5:
            color = 'yellow';
            break;
        case 2:
        case 6:
            color = 'green';
            break;
        case 3:
        case 7:
            color = 'blue';
            break;
    }

    return color;
}

// Look up the card's type based on position in the sprite sheet
function cardType(card) {
    switch(card % 14) {
        case 10: // Skip
            return 'skip';
        case 11: // Reverse
            return 'reverse';
        case 12: // Draw 2
            return 'draw2';
        case 13: // Wild or Wild Draw 4
            if(Math.floor(card / 14) >= 4) {
                return 'draw4';
            } else {
                return 'wild';
            }
        default:
            return card % 14;
    }
}

// Look up the card's point value (for end-game scoring) based on position in the sprite sheet
function cardValue(card) {
    let points;
    switch(card % 14) {
        case 10: // Skip
        case 11: // Reverse
        case 12: // Draw 2
            points = 20;
            break;
        case 13: // Wild or Wild Draw 4
            points = 50;
            break;
        default:
            points = card % 14;
            break;
    }
    return points;
}

// Create new players
function createPlayers() {
    players.clear();
    let i = 0;

    io.sockets.sockets.forEach((socket) => {
        let hand = new Array();
        let player = {
            Name: socket.playerName, 
            PlayerID: i, 
            Points: 0, 
            Hand: hand, 
            SocketID: socket.id, 
            HasCalledUno: false, 
            HasCalledUnoMeThisTurn: false,
            HasCalledUnoYou: false, 
            LastUnoMeTime: 0,
            LastUnoYouTime: 0
        };
        player.WaitingForColorChoice = false;
        players.set(socket.id, player);
        i++;
    });
};

// Create a new deck
function createDeck() {
    deck = new Array();

    for(let i = 0; i < 112; i++) {
        let color = cardColor(i);
        let type = cardType(i);
        let value = cardValue(i);

        let card = {'ID': i, 'Color': color, 'Type': type, 'Value': value};
        deck.push(card);
    }

    shuffle(deck);
}

// Shuffle the deck
function shuffle(deck) {
    let i, j, temp;
    for(i = deck.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        temp = deck[i];
        deck[i] = deck[j];
        deck[j] = temp;
    }
}

// Deal new cards to every player
function dealHands() {
    for(let i = 0; i < 7; i++) {
        players.forEach((player) => {
            let card = deck.pop();
            player.Hand.push(card);
            io.emit('renderCard', card, player);
        });
    }

    do {
        // Discard 1 card to start the game until we start on something other than a wild
        card = deck.pop();
        discardCard(card, -1);
    } while(card.Type === 'wild' || card.Type === 'draw4')
}

// Draw a card
function performDraw(player) {
    // Reshuffle deck/dicard pile if the deck runs out
    if(deck.length < 1) { 
        const tempCard = discardPile.pop();
        deck = discardPile;
        discardPile = [tempCard];
        shuffle(deck);
    }

    const card = deck.pop();
    player.Hand.push(card);
    io.emit('renderCard', card, player);

    io.emit('cardDrawn');
}

// Handle draw card events
function drawCards(SocketID, num) {
    if (num <= 0) return;

    const player = players.get(SocketID);
    if (!player) return;

    for (let i = 0; i < num; i++) {
        // Delay between each card draw
        setTimeout(() => performDraw(player), i * CARD_DRAW_DELAY_MS);
    }

    const label = num === 1 ? ' card' : ' cards';
    io.emit('logMessage', `${player.Name} drew ${num}${label}`);

    cardsToDraw = 0;

    // After drawing reset their Uno status
    player.HasCalledUno = false;
    io.to(SocketID).emit('notCalledUnoMe');
}

// Automatically draw cards until the player can play
function autoDraw(SocketID) {
    const player = players.get(SocketID);
    if (!player) return;

    // Draw until the player can play
    const tryDraw = () => {
        if (!canPlay(SocketID, ['none'])) {
            performDraw(player);
            io.emit('logMessage', `${player.Name} drew 1 card`);
            setTimeout(tryDraw, CARD_DRAW_DELAY_MS);
        } else {
            // After drawing reset their Uno status
            player.HasCalledUno = false;
            io.to(SocketID).emit('notCalledUnoMe');
        }
    };

    tryDraw();
}

// Check if a player has won
function checkForWin(SocketID) {
    let player = players.get(SocketID);

    // They win if they have 0 cards left
    if(player.Hand.length === 0) {
        let winner = players.get(currentPlayer);

        // Tally up points
        const summary = getPoints(players, winner);
        summary.winner = winner.Name;

        // Let everyone know the game's over
        gameIsOver = true;
        io.emit('turnChange', -1);
        io.emit('handSummary', summary);
        io.emit('gameOver', winner.Name);
        io.emit('logMessage', winner.Name + ' won the game');
    }
}

// Tally up points at the end of a hand
function getPoints(players, winner) {
    let pointsThisHand = 0;
    const breakdown = [];

    // Count value of cards in each player's hand
    players.forEach((player) => {
        if (player.SocketID !== winner.SocketID) {
            const pts = player.Hand.reduce((sum, card) => sum + card.Value, 0);

            breakdown.push({ 
                name: player.Name, 
                points: pts 
            });
            pointsThisHand += pts;
        }
    });

    // Update the scores
    winner.Points += pointsThisHand;
    io.emit('updateScore', winner.PlayerID, winner.Points);

    const standings = Array.from(players.values())
        .map(p => ({ name: p.Name, points: p.Points }))
        .sort((a, b) => b.points - a.points);

    return { 
        pointsThisHand, 
        breakdown,
        standings 
    };
}

// Discard a card
function discardCard(card, SocketID) {
    let player;

    // If it's a real player (e.g. not dealing a card to the discard pile) then remove the card from their hand
    if(SocketID != -1) {
        player = players.get(SocketID);
        let cardIndex = player.Hand.findIndex(item => item.ID == card.ID);
        player.Hand.splice(cardIndex, 1);
    }

    // Add the card to the discard pile and update the game's current color/card type
    discardPile.push(card);
    if (card.Color !== 'black') currentColor = card.Color;
    currentType = card.Type;
    io.emit('discardCard', card, player);
}

// Advance to the next player's turn
function nextTurn(skipAutoDraw = false) {
    if (gameIsOver) return;
    let player = players.get(currentPlayer);
    let currentPlayerID = player.PlayerID;

    currentPlayerID += playDirection;

    // Players are numbered from 0 to n. Loop around if we iterate outside of the 0 to n range.
    if(currentPlayerID < 0) {
        currentPlayerID += players.size;
    } else if(currentPlayerID >= players.size) {
        currentPlayerID -= players.size;
    }

    players.forEach((nextPlayer) => {
        if(nextPlayer.PlayerID == currentPlayerID) {
            currentPlayer = nextPlayer.SocketID;
        }
    });

    players.forEach((p) => { 
        p.HasCalledUnoYou = false; 
        p.HasCalledUnoMeThisTurn = false;
    });

    io.emit('notCalledUnoMe');
    io.emit('notCalledUnoYou');

    // Draw a card if the next player can't play anything
    if(!skipAutoDraw) {
        let hasCard = canPlay(currentPlayer, ['none']);
        if(!hasCard) {
            autoDraw(currentPlayer);
        }
    }

    player = players.get(currentPlayer);
    requiredPlay = new Array();
    io.to(currentPlayer).emit('requiredPlay', requiredPlay);
    io.emit('turnChange', currentPlayerID);
}

// Check if a player can play a card, excluding some invalidCards
function canPlay(currentPlayer, invalidCards) {
    let player = players.get(currentPlayer);

    return player.Hand.some(card => {
        if (invalidCards.includes(card.Type)) return false;
        return (
            card.Color === currentColor ||
            card.Color === 'black' ||
            card.Type === currentType
        );
    });
}

// Start a new game
function startGame() {
    // Reset some game variables
    gameIsOver = false;
    playDirection = -1;
    cardsToDraw = 0;
    discardPile = new Array();
    requiredPlay = new Array();
    io.emit('requiredPlay', requiredPlay);
    io.emit('notCalledUnoMe');
    io.emit('colorChosen', 'red');
    io.emit('hideColor');
    io.emit('hideDraw');

    // Randomly select a new player to play first
    let currentPlayerID = Math.floor(Math.random() * players.size);

    // Reset each player's hand
    players.forEach((player) => {
        player.Hand = [];
        player.HasCalledUno = false;
        player.HasCalledUnoMeThisTurn = false;
        player.HasCalledUnoYou = false;
        player.LastUnoMeTime = 0;
        player.LastUnoYouTime = 0;
        if(player.PlayerID == currentPlayerID) {
            currentPlayer = player.SocketID;
        }
    });

    io.emit('notCalledUnoMe');
    io.emit('notCalledUnoYou');

    // Tell everyone a new game is started, make a new deck, and deal new hands
    io.emit('gameStarted', Array.from(players.values()));
    createDeck();
    dealHands();

    // Check that the first player can play a card, or have them draw
    let hasCard = canPlay(currentPlayer, ['none']);
    if(!hasCard) {
        autoDraw(currentPlayer);
    }
    
    // Mark the first player as active
    io.emit('turnChange', currentPlayerID);
}
