const { clear } = require('console');
const { resolve } = require('dns');
const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 3000;

const {
    buildCard, createDeck: buildDeck, shuffle,
    canPlay: canPlayHand, getPoints, nextPlayerID, reshuffleSeats: reshuffleSeatsMap,
} = require('./Gamelogic');

app.use(express.static(__dirname + '/public', { 'Content-Type': 'application/javascript' }));
io.on('connection', onConnection);
server.listen(port, () => console.log('listening on port ' + port));

// ── Game constants ──
const maxPlayers = 8;
const CARD_DRAW_DELAY_MS = 300; // milliseconds between each card drawn in a multi-draw sequence

// ── Game state ──
let playDirection = -1;  // 1 = clockwise, -1 = counter-clockwise
let currentPlayer;       // socket ID of the player whose turn it is
let currentColor;        // active card color
let currentType;         // active card type (number, skip, etc.)
let cardsToDraw = 0;     // accumulated cards a player must draw (from stacked draw 2s / draw 4s)
let discardPile = [];
let players = new Map(); // socket ID → player object
let playersInLobby = []; // ordered list of player names, for the lobby display
let hostName = null;
let deck = [];
let playerA = null;      // socket ID of the host
let gameIsOver = false;
let pendingWinnerSocketId = null; // deferred win check — set when a player empties their hand on a draw card

// ── Per-hand / per-match stats ──
let matchStartTime = null;
let handStartTime = null;
let handsPlayed = 0;
let matchCardsPlayed = 0;
let handCardsPlayed = 0;
let turnStartTime = null;

// ── Options (all off by default) ──
let playWildDraw4 = false;  // allow Wild Draw 4 regardless of hand contents
let stackDraw2 = false;     // next player can stack a Draw 2 on a Draw 2
let skipDraw2 = false;      // next player can play a Skip to dodge a Draw 2
let reverseDraw2 = false;   // next player can play a Reverse to dodge a Draw 2
let stackDraw4 = false;
let skipDraw4 = false;
let reverseDraw4 = false;

// All card types — used to build the "excluded" list when checking who can stack
const cardList = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 'skip', 'reverse', 'draw2', 'wild', 'draw4'];

// Cards a player is required to play on their turn (e.g. when stacking is enabled)
let requiredPlay = [];


function onConnection(socket) {

    // Boot a player from the game (host only)
    socket.on('bootPlayer', (targetName) => {
        if(socket.id == playerA) {
            const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.playerName === targetName);
            if(targetSocket) {
                // Capture the socket ID before disconnecting — it may become stale after disconnect(true)
                const targetSocketId = targetSocket.id;
                const wasCurrentPlayer = (targetSocketId === currentPlayer);

                // Flag the socket so the disconnect handler skips its grace-period cleanup
                targetSocket.wasBooted = true;

                targetSocket.emit('booted');

                // If it's the booted player's turn, advance BEFORE removing them —
                // nextTurn() calls players.get(currentPlayer) and crashes if they're already gone.
                // Also skip if only 1 player would remain: no turn to advance to.
                if (wasCurrentPlayer && players.size > 2) {
                    nextTurn();
                }

                // Clean up state before disconnecting to prevent a race with the disconnect handler
                playersInLobby = playersInLobby.filter(p => p !== targetName);
                players.delete(targetSocketId);

                targetSocket.disconnect(true);

                io.emit('playerLeft', { playerName: targetName, playerId: -1 });
                io.emit('setHost', hostName);
                io.emit('newPlayer', { players: playersInLobby, host: hostName });
                io.emit('logMessage', targetName + ' was booted by the host');

                // End the game if too few players remain to continue
                if (players.size <= 1) {
                    gameIsOver = true;
                    io.emit('turnChange', -1);
                    io.emit('logMessage', 'Game over — not enough players to continue');
                }
            }
        }
    });

    socket.on('disconnect', () => {
        // If this socket was booted by the host, bootPlayer already cleaned everything up
        if (socket.wasBooted) return;

        const disconnectedName = socket.playerName;
        const disconnectedId = socket.id;
        const REJOIN_GRACE_MS = 10000; // how long to wait before treating a disconnect as a permanent leave

        // If the host disconnected, promote a new host immediately — don't wait
        // for the grace period, so other players aren't stuck on the waiting overlay.
        if (disconnectedId === playerA) {
            playerA = null;
            hostName = null;
            const nextSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.id !== disconnectedId && s.playerName);
            if (nextSocket) {
                playerA = nextSocket.id;
                hostName = nextSocket.playerName;
                io.to(nextSocket.id).emit('isPlayerA', { gameInProgress: !gameIsOver });
                io.to(nextSocket.id).emit('updateOptions', { playWildDraw4, stackDraw2, skipDraw2, reverseDraw2, stackDraw4, skipDraw4, reverseDraw4 });
                io.emit('setHost', hostName);
                io.emit('newPlayer', { players: playersInLobby, host: hostName });
            }
        }

        setTimeout(() => {
            // Check if the player rejoined with a new socket during the grace period
            const hasRejoined = Array.from(players.values()).some(
                p => p.Name === disconnectedName
            );

            if (!hasRejoined) {
                playersInLobby = playersInLobby.filter(p => p !== disconnectedName);
                const leavingPlayer = players.get(disconnectedId);
                const leavingPlayerId = leavingPlayer ? leavingPlayer.PlayerID : -1;
                players.delete(disconnectedId);
                io.emit('playerLeft', { playerName: disconnectedName, playerId: leavingPlayerId });
                io.emit('newPlayer', { players: playersInLobby, host: hostName });
                io.emit('logMessage', disconnectedName + ' left the game');

                if (disconnectedId === currentPlayer && !gameIsOver) {
                    nextTurn();
                }
            }
        }, REJOIN_GRACE_MS);
    });

    // Handle a player joining or rejoining the lobby
    socket.on('requestJoin', function(playerName) {
        playerName = playerName.substring(0, 29);
        socket.playerName = playerName;

        // Check if this is a player rejoining with a new socket after disconnecting
        let rejoiningPlayer = null;
        for (let [oldSocketId, player] of players.entries()) {
            if (player.Name === playerName) {
                rejoiningPlayer = player;
                // Swap the old socket ID for the new one
                players.delete(oldSocketId);
                player.SocketID = socket.id;
                players.set(socket.id, player);

                if (currentPlayer === oldSocketId) {
                    currentPlayer = socket.id;
                }
                if (oldSocketId === playerA) {
                    playerA = socket.id;
                }
                break;
            }
        }

        if (rejoiningPlayer) {
            // Send the full game state to the rejoining player, hiding other players' cards
            const currentPlayerObj = players.get(currentPlayer);
            const sanitizedList = Array.from(players.values()).map(p => ({
                ...p,
                Hand: p.SocketID === socket.id ? p.Hand : p.Hand.map(() => ({}))
            }));

            io.to(socket.id).emit('rejoinState', {
                playerList: sanitizedList,
                mySocketId: socket.id,
                currentPlayerId: currentPlayerObj ? currentPlayerObj.PlayerID : -1,
                currentColor: currentColor,
                topCard: discardPile.length > 0 ? discardPile[discardPile.length - 1] : null,
                gameIsOver: gameIsOver,
                requiredPlay: requiredPlay,
                isHost: socket.id === playerA,
                hostName: hostName,
                playersInLobby: playersInLobby,
                playWildDraw4
            });
            io.emit('newPlayer', { players: playersInLobby, host: hostName });
            io.emit('logMessage', playerName + ' rejoined the game');
            if (socket.id === playerA) {
                io.to(socket.id).emit('isPlayerA', { gameInProgress: !gameIsOver });
                io.to(socket.id).emit('updateOptions', { playWildDraw4, stackDraw2, skipDraw2, reverseDraw2, stackDraw4, skipDraw4, reverseDraw4 });
                io.emit('setHost', hostName);
            }
            return;
        }

        // First player to join becomes the host
        if(playerA == null) {
            playerA = socket.id;
            hostName = playerName;
            io.to(socket.id).emit('isPlayerA');
            io.emit('setHost', hostName);
        }

        io.to(socket.id).emit('updateOptions', {playWildDraw4});

        let people;
        try {
            people = io.engine.clientsCount;
        } catch (e) {
            people = 0;
        }

        if(people < maxPlayers) {
            socket.join();
            if (!playersInLobby.includes(playerName)) {
                playersInLobby.push(playerName);
            }
            io.to(socket.id).emit('responseRoom', [people + 1, maxPlayers]);
            io.emit('newPlayer', {players: playersInLobby, host: hostName});
            io.emit('logMessage', playerName + ' joined the game');

            return;
        } else {
            io.to(socket.id).emit('responseRoom', 'error');
        }
    });

    // Start a new match (resets scores and seats)
    socket.on('resetGame', function() {
        let playerCount = io.engine.clientsCount;
        matchStartTime = Date.now();
        handsPlayed = 0;
        matchCardsPlayed = 0;

        if(playerCount > 1) {
            io.emit('logMessage', 'A new match was started');
            createPlayers();
            startGame();
        }
    });

    // Deal a new hand without resetting scores
    socket.on('newHand', function() {
        io.emit('logMessage', 'A new hand was dealt');
        reshuffleSeats();
        startGame();
    });

    socket.on('playCard', async function(card) {
        let player = players.get(socket.id);
        if (!player) return;
        if (player.WaitingForColorChoice) return; // don't process further input while color picker is open

        let playColor = card.Color;
        let playType = card.Type;

        // Only process the play if it's this player's turn
        if(socket.id == currentPlayer) {

            let colorMatch = (playColor == currentColor && playColor != 'black');
            let typeMatch = (playType == currentType && playColor != 'black');
            let wild = (playType == 'wild');
            let draw4wild = false;

            if(playWildDraw4) {
                draw4wild = (playType == 'draw4');
            } else {
                // Wild Draw 4 is only legal if the player has no other playable card
                draw4wild = (playType == 'draw4' && !canPlay(currentPlayer, ['draw4']));
            }

            // Play is legal if it matches color/type/wild, and satisfies any stacking requirement
            if((colorMatch || typeMatch || wild || draw4wild) && (requiredPlay.length == 0 || requiredPlay.includes(playType))) {
                handCardsPlayed++;

                // Track per-player turn stats
                const playingPlayer = players.get(socket.id);
                if (playingPlayer) {
                    playingPlayer.HandCardsPlayed++;
                    playingPlayer.MatchCardsPlayed++;
                    if (turnStartTime !== null) {
                        const elapsed = (Date.now() - turnStartTime) / 1000;
                        playingPlayer.HandTurnTime += elapsed;
                        playingPlayer.MatchTurnTime += elapsed;
                    }
                    turnStartTime = null;
                }
                requiredPlay = [];
                io.to(currentPlayer).emit('requiredPlay', requiredPlay);
                discardCard(card, socket.id);
                io.emit('hideColor');
                io.emit('logMessage', socket.playerName + ' played a ' + playColor + ' ' + playType);

                // Defer the win check for draw/skip/reverse cards — the effect still needs to resolve
                const isDefferedWin = (playType === 'draw2' || playType === 'draw4') ||
                    ((playType === 'skip' || playType === 'reverse') && cardsToDraw > 0);
                if (!isDefferedWin) {
                    checkForWin(socket.id);
                }

                if(playType == 'wild') {
                    player.WaitingForColorChoice = true;
                    io.to(socket.id).emit('chooseColor');
                } else if(playType == 'draw4') {
                    cardsToDraw += 4;
                    player.WaitingForColorChoice = true;

                    // Build the list of cards the next player is allowed to play
                    requiredPlay = [];
                    if(stackDraw4) requiredPlay.push('draw4');
                    if(skipDraw4) requiredPlay.push('skip');
                    if(reverseDraw4) requiredPlay.push('reverse');
                    io.to(socket.id).emit('chooseColor');
                } else if(playType == 'skip' || (playType == 'reverse' && players.size == 2)) {
                    // With 2 players, Reverse acts as a Skip
                    if (players.get(socket.id).Hand.length === 0) {
                        pendingWinnerSocketId = socket.id;
                    }

                    await nextTurn(true); // advance past the skipped player
                    clearRequiredPlay();

                    // If draw cards were stacked and a skip dodged them, deal them to the player after
                    if (cardsToDraw > 0) {
                        await drawCards(currentPlayer, cardsToDraw);
                        resolvePendingWin();
                    }
                    nextTurn();
                } else if(playType == 'reverse') {
                    if (players.get(socket.id).Hand.length === 0) {
                        pendingWinnerSocketId = socket.id;
                    }

                    playDirection = -playDirection;
                    await nextTurn(true);
                    clearRequiredPlay();

                    // If draw cards were stacked and a reverse dodged them, deal them to the new next player
                    if(cardsToDraw > 0) {
                        await drawCards(currentPlayer, cardsToDraw);
                        resolvePendingWin();
                        nextTurn();
                    } else {
                        resolvePendingWin();
                        if(!gameIsOver && !canPlay(currentPlayer, ['none'])) {
                            autoDraw(currentPlayer);
                        }
                    }
                } else if(playType == 'draw2') {
                    cardsToDraw += 2;
                    if (players.get(socket.id).Hand.length === 0) {
                        pendingWinnerSocketId = socket.id;
                    }
                    await nextTurn(true);

                    // Build the list of cards the next player is allowed to play (stack, skip, or reverse)
                    requiredPlay = [];
                    if(stackDraw2) requiredPlay.push('draw2');
                    if(skipDraw2) requiredPlay.push('skip');
                    if(reverseDraw2) requiredPlay.push('reverse');
                    io.to(currentPlayer).emit('requiredPlay', requiredPlay);

                    // If the next player has nothing to stack with, they draw immediately
                    let tempArray = cardList.filter(item => !requiredPlay.includes(item));
                    if(!canPlay(currentPlayer, tempArray)) {
                        await drawCards(currentPlayer, cardsToDraw);
                        clearRequiredPlay();
                        resolvePendingWin();
                        nextTurn();
                    }
                } else {
                    // Numbered card — just advance the turn
                    nextTurn();
                }
            }
        }
    });

    // Player manually draws from the pile
    socket.on('drawCard', function() {
        autoDraw(socket.id);
    });

    // Advance the game after the player picks a color following a wild
    socket.on('colorChosen', async function(color) {
        let player = players.get(socket.id);
        if (!player) return;

        player.WaitingForColorChoice = false;

        currentColor = color;
        io.emit('colorChosen', color);
        io.emit('logMessage', 'The color was changed to ' + color);

        if(cardsToDraw > 0) {
            // Wild Draw 4 path — resolve stacking before dealing cards
            if (players.get(socket.id).Hand.length === 0) {
                pendingWinnerSocketId = socket.id;
            }
            await nextTurn(true);

            requiredPlay = [];
            if(stackDraw4) requiredPlay.push('draw4');
            if(skipDraw4) requiredPlay.push('skip');
            if(reverseDraw4) requiredPlay.push('reverse');
            io.emit('requiredPlay', requiredPlay);

            let tempArray = cardList.filter(item => !requiredPlay.includes(item));

            if(!canPlay(currentPlayer, tempArray)) {
                await drawCards(currentPlayer, cardsToDraw);
                clearRequiredPlay();
                resolvePendingWin();
                nextTurn();
            }
        } else {
            // Plain wild — color is set, just move on
            nextTurn();
        }
    });

    // Player called Uno for themselves
    socket.on('unoMe', function() {
        let player = players.get(socket.id);
        if (!player) return;

        if (player.HasCalledUnoMeThisTurn) return; // can't call it twice in one turn

        player.HasCalledUnoMeThisTurn = true;
        io.to(socket.id).emit('calledUnoMe');

        const now = Date.now();
        const GRACE_MS = 1000; // forgiveness window if unoYou fires at the same instant

        player.LastUnoMeTime = Date.now();

        // Valid call: it's their turn with ≤2 cards, or they're down to 1 card on any turn
        if((player.Hand.length <= 2 && socket.id == currentPlayer) || player.Hand.length == 1) {
            if (!player.HasCalledUno) {
                io.emit('logMessage', socket.playerName + ' called Uno');
                player.HasCalledUno = true;
            }
        } else {
            // Invalid call — penalize unless they were just called on (avoid double penalty)
            const recentlyGotUnoYou = player.LastUnoYouTime && (now - player.LastUnoYouTime < GRACE_MS);

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

        if (caller.HasCalledUnoYou) return; // can only call once per turn

        caller.HasCalledUnoYou = true;
        io.to(socket.id).emit('calledUnoYou');

        const now = Date.now();
        const GRACE_MS = 1000;

        players.forEach((player) => {
            const recentlyCalledUnoMe = player.LastUnoMeTime && (now - player.LastUnoMeTime < GRACE_MS);

            // Catch any player who has 1 card and hasn't called Uno (and didn't just call it)
            if(player.Hand.length == 1 && !player.HasCalledUno && !recentlyCalledUnoMe) {
                io.emit('logMessage', player.Name + ' had Uno called on them by ' + caller.Name);
                drawCards(player.SocketID, 4);
                player.LastUnoYouTime = Date.now();
            };
        });
    });

    // Save updated game options sent by the host
    socket.on('saveOptions', (data) => {
        let selectedOptions = data.options;

        playWildDraw4 = selectedOptions.includes('playWildDraw4');
        stackDraw2 = selectedOptions.includes('stackDraw2');
        skipDraw2 = selectedOptions.includes('skipDraw2');
        reverseDraw2 = selectedOptions.includes('reverseDraw2');
        stackDraw4 = selectedOptions.includes('stackDraw4');
        skipDraw4 = selectedOptions.includes('skipDraw4');
        reverseDraw4 = selectedOptions.includes('reverseDraw4');

        const allOptions = { playWildDraw4, stackDraw2, skipDraw2, reverseDraw2, stackDraw4, skipDraw4, reverseDraw4 };
        io.emit('updateOptions', allOptions);

        const optionLabels = {
            playWildDraw4: 'Play Wild Draw 4 any time',
            stackDraw2: 'Stack Draw 2s', skipDraw2: 'Skip Draw 2s', reverseDraw2: 'Reverse Draw 2s',
            stackDraw4: 'Stack Draw 4s', skipDraw4: 'Skip Draw 4s', reverseDraw4: 'Reverse Draw 4s',
        };
        io.emit('optionsChanged', { changedBy: socket.playerName, options: allOptions, labels: optionLabels });
    });
}

// ── Thin wrappers around pure functions ──────────────────────────────────────
// These bridge the pure gameLogic.js API (which takes explicit arguments) and
// the server's module-level state (currentColor, currentType, players Map).

// Returns true if the player with the given socket ID has a legally playable card
function canPlay(socketId, invalidCards) {
    const player = players.get(socketId);
    return canPlayHand(player.Hand, currentColor, currentType, invalidCards);
}

// Randomly reassign seat positions between hands
function reshuffleSeats() {
    reshuffleSeatsMap(players);
}

// Build a new shuffled deck and assign it to the module-level deck variable
function createDeck() {
    deck = buildDeck();
}

// ── Server-side game functions ────────────────────────────────────────────────

// Build the players Map from all currently connected sockets
function createPlayers() {
    players.clear();

    Array.from(io.sockets.sockets.values()).forEach((socket, i) => {
        const player = {
            Name: socket.playerName,
            PlayerID: i,
            Points: 0,
            HandsWon: 0,
            Hand: [],
            SocketID: socket.id,
            HasCalledUno: false,
            HasCalledUnoMeThisTurn: false,
            HasCalledUnoYou: false,
            LastUnoMeTime: 0,
            LastUnoYouTime: 0,
            HandCardsPlayed: 0,
            MatchCardsPlayed: 0,
            HandTurnTime: 0,
            MatchTurnTime: 0,
            PointsGivenUp: 0,
            WaitingForColorChoice: false
        };
        players.set(socket.id, player);
    });
}

// Deal 7 cards to each player, then flip the first non-wild card to start the discard pile
function dealHands() {
    for(let i = 0; i < 7; i++) {
        players.forEach((player) => {
            let card = deck.pop();
            player.Hand.push(card);
            io.to(player.SocketID).emit('renderCard', card, player);
            io.emit('renderOpponentCard', player.PlayerID);
        });
    }

    do {
        // Keep flipping until the opening card isn't a wild
        card = deck.pop();
        discardCard(card, -1);
    } while(card.Type === 'wild' || card.Type === 'draw4')
}

// Draw one card for a player, reshuffling the discard pile into the deck if needed
function performDraw(player) {
    if(deck.length < 1) {
        // Keep the top discard card in place; shuffle the rest back into the deck
        const tempCard = discardPile.pop();
        deck = discardPile;
        discardPile = [tempCard];
        shuffle(deck);
    }

    const card = deck.pop();
    player.Hand.push(card);
    io.to(player.SocketID).emit('renderCard', card, player);
    io.emit('renderOpponentCard', player.PlayerID);

    io.emit('cardDrawn');
}

// Draw a fixed number of cards for a player, with a staggered delay between each
function drawCards(SocketID, num) {
    if (num <= 0) return Promise.resolve();

    const player = players.get(SocketID);
    if (!player) return Promise.resolve();

    const label = num === 1 ? ' card' : ' cards';
    io.emit('logMessage', `${player.Name} drew ${num}${label}`);

    cardsToDraw = 0;

    player.HasCalledUno = false;
    io.to(SocketID).emit('notCalledUnoMe');

    io.to(SocketID).emit('drawStart');

    return new Promise((resolve) => {
        for (let i = 0; i < num; i++) {
            setTimeout(() => {
                performDraw(player);
                if (i === num - 1) {
                    io.to(SocketID).emit('drawEnd');
                    resolve();
                }
            }, i * CARD_DRAW_DELAY_MS);
        }
    });
}

// Draw cards one at a time until the player has something playable
function autoDraw(SocketID) {
    if (gameIsOver) return Promise.resolve();
    const player = players.get(SocketID);
    if (!player) return Promise.resolve();

    return new Promise((resolve) => {
        const tryDraw = () => {
            if (!canPlay(SocketID, ['none'])) {
                performDraw(player);
                io.emit('logMessage', `${player.Name} drew 1 card`);
                setTimeout(tryDraw, CARD_DRAW_DELAY_MS);
            } else {
                player.HasCalledUno = false;
                io.to(SocketID).emit('notCalledUnoMe');
                // Charge the draw time to this player's turn
                if (turnStartTime !== null) {
                    const elapsed = (Date.now() - turnStartTime) / 1000;
                    player.HandTurnTime += elapsed;
                    player.MatchTurnTime += elapsed;
                    turnStartTime = null;
                }
                resolve();
            }
        };

        tryDraw();
    });
}

// Check if the given player has won (empty hand), and end the hand/match if so
function checkForWin(SocketID) {
    let player = players.get(SocketID);

    if(player.Hand.length === 0) {
        let winner = players.get(SocketID);

        const summary = getPoints(players, winner);
        io.emit('updateScore', winner.PlayerID, winner.Points, winner.HandsWon);

        summary.winner = winner.Name;
        summary.handDuration = (Date.now() - handStartTime) / 1000;
        summary.matchDuration = (Date.now() - matchStartTime) / 1000;
        handsPlayed++;
        matchCardsPlayed += handCardsPlayed;
        summary.handsPlayed = handsPlayed;
        summary.handCardsPlayed = handCardsPlayed;
        summary.matchCardsPlayed = matchCardsPlayed;

        gameIsOver = true;
        io.emit('turnChange', -1);
        io.emit('handSummary', summary);
        io.emit('gameOver', winner.Name);
        io.emit('logMessage', winner.Name + ' won the game');
    }
}

// Remove a card from a player's hand and push it onto the discard pile
function discardCard(card, SocketID) {
    let player;

    // SocketID of -1 means this is the initial flip at game start, not a player play
    if(SocketID != -1) {
        player = players.get(SocketID);
        let cardIndex = player.Hand.findIndex(item => item.ID == card.ID);
        player.Hand.splice(cardIndex, 1);
    }

    discardPile.push(card);
    if (card.Color !== 'black') currentColor = card.Color;
    currentType = card.Type;
    io.emit('discardCard', card, player);

    if (SocketID !== -1) {
        io.emit('removeOpponentCard', player.PlayerID);
    }
}

// Clear the required-play list and broadcast the update to all clients
function clearRequiredPlay() {
    requiredPlay = [];
    io.emit('requiredPlay', requiredPlay);
}

// Resolve a win that was deferred while a draw card effect played out
function resolvePendingWin() {
    if (pendingWinnerSocketId) {
        checkForWin(pendingWinnerSocketId);
        pendingWinnerSocketId = null;
    }
}

// Advance to the next player's turn, optionally skipping the auto-draw check
async function nextTurn(skipAutoDraw = false) {
    if (gameIsOver) return;
    let player = players.get(currentPlayer);

    const nextID = nextPlayerID(player.PlayerID, playDirection, players.size);

    players.forEach((nextPlayer) => {
        if(nextPlayer.PlayerID == nextID) {
            currentPlayer = nextPlayer.SocketID;
        }
    });

    // Reset Uno-call state for all players at the start of each turn
    players.forEach((p) => {
        p.HasCalledUnoYou = false;
        p.HasCalledUnoMeThisTurn = false;
    });

    io.emit('notCalledUnoMe');
    io.emit('notCalledUnoYou');

    if(!skipAutoDraw) {
        let hasCard = canPlay(currentPlayer, ['none']);
        if(!hasCard) {
            autoDraw(currentPlayer);
        }
    }

    clearRequiredPlay();
    io.to(currentPlayer).emit('requiredPlay', requiredPlay);
    io.emit('turnChange', nextID);
    turnStartTime = Date.now();
}

// Reset game state and deal a new hand
async function startGame() {
    gameIsOver = false;
    playDirection = -1;
    cardsToDraw = 0;
    pendingWinnerSocketId = null;
    handStartTime = Date.now();
    handCardsPlayed = 0;
    discardPile = [];
    clearRequiredPlay();
    io.emit('notCalledUnoMe');
    io.emit('colorChosen', 'red');
    io.emit('hideColor');
    io.emit('hideDraw');

    // Randomly pick the first player
    let currentPlayerID = Math.floor(Math.random() * players.size);

    players.forEach((player) => {
        player.Hand = [];
        player.HasCalledUno = false;
        player.HasCalledUnoMeThisTurn = false;
        player.HasCalledUnoYou = false;
        player.LastUnoMeTime = 0;
        player.LastUnoYouTime = 0;
        player.WaitingForColorChoice = false;
        player.HandCardsPlayed = 0;
        player.HandTurnTime = 0;
        if(player.PlayerID == currentPlayerID) {
            currentPlayer = player.SocketID;
        }
    });

    io.emit('notCalledUnoMe');
    io.emit('notCalledUnoYou');

    io.emit('gameStarted', Array.from(players.values()));
    createDeck();
    dealHands();

    // If the first player has nothing to play, draw for them before the turn starts
    let hasCard = canPlay(currentPlayer, ['none']);
    if(!hasCard) {
        await autoDraw(currentPlayer);
    }

    io.emit('turnChange', currentPlayerID);
    turnStartTime = Date.now();
}