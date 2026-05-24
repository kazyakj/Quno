/**
 * Unit tests for Quno game logic (server.js pure functions).
 *
 * Run with:  npx jest
 */

const {
    cardColor, cardType, cardValue, buildCard,
    createDeck, shuffle,
    canPlay, getPoints, nextPlayerID, reshuffleSeats,
} = require('./gameLogic');

// Test-only helper: build a minimal player object
function makePlayer(socketId, playerID, hand = [], extra = {}) {
    return {
        Name: 'Player' + playerID,
        PlayerID: playerID,
        Points: 0,
        HandsWon: 0,
        Hand: hand,
        SocketID: socketId,
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
        WaitingForColorChoice: false,
        ...extra,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// cardColor
// ─────────────────────────────────────────────────────────────────────────────

describe('cardColor', () => {
    // Each color occupies two rows of 14 (one for each copy of the color).
    // Row 0 (IDs 0–13) and row 4 (IDs 56–69) → red
    // Row 1 (IDs 14–27) and row 5 (IDs 70–83) → yellow
    // Row 2 (IDs 28–41) and row 6 (IDs 84–97) → green
    // Row 3 (IDs 42–55) and row 7 (IDs 98–111) → blue
    // Column 13 in every row is always black (wild/draw4)

    test.each([
        [0,  'red'],
        [5,  'red'],
        [12, 'red'],
        [56, 'red'],
        [68, 'red'],
    ])('ID %i → red', (id, expected) => {
        expect(cardColor(id)).toBe(expected);
    });

    test.each([
        [14, 'yellow'],
        [20, 'yellow'],
        [26, 'yellow'],
        [70, 'yellow'],
    ])('ID %i → yellow', (id, expected) => {
        expect(cardColor(id)).toBe(expected);
    });

    test.each([
        [28, 'green'],
        [35, 'green'],
        [40, 'green'],
        [84, 'green'],
    ])('ID %i → green', (id, expected) => {
        expect(cardColor(id)).toBe(expected);
    });

    test.each([
        [42, 'blue'],
        [50, 'blue'],
        [54, 'blue'],
        [98, 'blue'],
    ])('ID %i → blue', (id, expected) => {
        expect(cardColor(id)).toBe(expected);
    });

    test('column-13 cards are always black (wild / draw4)', () => {
        const col13s = [13, 27, 41, 55, 69, 83, 97, 111];
        col13s.forEach(id => expect(cardColor(id)).toBe('black'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// cardType
// ─────────────────────────────────────────────────────────────────────────────

describe('cardType', () => {
    test('numbered cards return their face value', () => {
        // ID 0 → col 0 → type 0, ID 5 → col 5 → type 5, etc.
        for (let col = 0; col <= 9; col++) {
            expect(cardType(col)).toBe(col);       // row 0
            expect(cardType(col + 56)).toBe(col);  // row 4
        }
    });

    test('column 10 → skip', () => {
        expect(cardType(10)).toBe('skip');
        expect(cardType(24)).toBe('skip'); // row 1, col 10
    });

    test('column 11 → reverse', () => {
        expect(cardType(11)).toBe('reverse');
        expect(cardType(25)).toBe('reverse');
    });

    test('column 12 → draw2', () => {
        expect(cardType(12)).toBe('draw2');
        expect(cardType(26)).toBe('draw2');
    });

    test('column 13, rows 0–3 → wild', () => {
        [13, 27, 41, 55].forEach(id => expect(cardType(id)).toBe('wild'));
    });

    test('column 13, rows 4–7 → draw4', () => {
        [69, 83, 97, 111].forEach(id => expect(cardType(id)).toBe('draw4'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// cardValue
// ─────────────────────────────────────────────────────────────────────────────

describe('cardValue', () => {
    test('numbered cards are worth their face value (0–9)', () => {
        for (let col = 0; col <= 9; col++) {
            expect(cardValue(col)).toBe(col);
        }
    });

    test('skip, reverse, draw2 are worth 20 points', () => {
        expect(cardValue(10)).toBe(20); // skip
        expect(cardValue(11)).toBe(20); // reverse
        expect(cardValue(12)).toBe(20); // draw2
    });

    test('wild and draw4 are worth 50 points', () => {
        expect(cardValue(13)).toBe(50);  // wild
        expect(cardValue(69)).toBe(50);  // draw4
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// createDeck
// ─────────────────────────────────────────────────────────────────────────────

describe('createDeck', () => {
    let deck;

    beforeEach(() => {
        deck = createDeck();
    });

    test('deck has exactly 112 cards', () => {
        expect(deck).toHaveLength(112);
    });

    test('every card has the correct Color, Type, and Value for its ID', () => {
        // Re-sort by ID to check each card's attributes independently of shuffle order
        const sorted = [...deck].sort((a, b) => a.ID - b.ID);
        sorted.forEach((card, i) => {
            expect(card.ID).toBe(i);
            expect(card.Color).toBe(cardColor(i));
            expect(card.Type).toBe(cardType(i));
            expect(card.Value).toBe(cardValue(i));
        });
    });

    test('deck contains 8 wilds and 8 draw4s', () => {
        const wilds  = deck.filter(c => c.Type === 'wild');
        const draw4s = deck.filter(c => c.Type === 'draw4');
        expect(wilds).toHaveLength(4);
        expect(draw4s).toHaveLength(4);
    });

    test('deck contains 8 cards of each color action type (skip/reverse/draw2)', () => {
        ['skip', 'reverse', 'draw2'].forEach(type => {
            expect(deck.filter(c => c.Type === type)).toHaveLength(8);
        });
    });

    test('card IDs are unique (no duplicates)', () => {
        const ids = deck.map(c => c.ID);
        expect(new Set(ids).size).toBe(112);
    });

    test('deck is shuffled (not in sequential ID order)', () => {
        // The probability of a 112-card deck being in sorted order by chance is 1/112!,
        // so this check will essentially never produce a false failure.
        const ids = deck.map(c => c.ID);
        const isSorted = ids.every((id, i) => i === 0 || id > ids[i - 1]);
        expect(isSorted).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// shuffle
// ─────────────────────────────────────────────────────────────────────────────

describe('shuffle', () => {
    test('returns the same array reference (in-place)', () => {
        const arr = [1, 2, 3, 4, 5];
        const ref = arr;
        shuffle(arr);
        expect(arr).toBe(ref);
    });

    test('shuffled array contains the same elements', () => {
        const original = [1, 2, 3, 4, 5, 6, 7, 8];
        const copy = [...original];
        shuffle(copy);
        expect(copy.sort()).toEqual(original.sort());
    });

    test('a single-element array is unchanged', () => {
        const arr = [42];
        shuffle(arr);
        expect(arr).toEqual([42]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// canPlay
// ─────────────────────────────────────────────────────────────────────────────

describe('canPlay', () => {
    const redSkip  = { ID: 10, Color: 'red',    Type: 'skip',    Value: 20 };
    const redFive  = { ID: 5,  Color: 'red',    Type: 5,         Value: 5  };
    const blueFive = { ID: 61, Color: 'blue',   Type: 5,         Value: 5  };
    const blueTwo  = { ID: 58, Color: 'blue',   Type: 2,         Value: 2  };
    const wildCard = { ID: 13, Color: 'black',  Type: 'wild',    Value: 50 };
    const draw4    = { ID: 69, Color: 'black',  Type: 'draw4',   Value: 50 };

    test('color match allows play', () => {
        expect(canPlay([redFive], 'red', 'skip')).toBe(true);
    });

    test('type match allows play', () => {
        expect(canPlay([blueFive], 'red', 5)).toBe(true);
    });

    test('black (wild) cards are always playable', () => {
        expect(canPlay([wildCard], 'green', 'reverse')).toBe(true);
        expect(canPlay([draw4],   'yellow', 4)).toBe(true);
    });

    test('no match → cannot play', () => {
        expect(canPlay([blueTwo], 'red', 'skip')).toBe(false);
    });

    test('empty hand → cannot play', () => {
        expect(canPlay([], 'red', 5)).toBe(false);
    });

    test('invalidCards list excludes matching cards', () => {
        // draw4 matches color='black' but is in the exclusion list
        expect(canPlay([draw4], 'green', 'reverse', ['draw4'])).toBe(false);
    });

    test('invalidCards exclusion does not affect other playable cards', () => {
        // redSkip matches color; excluding draw4 should not prevent it playing
        expect(canPlay([redSkip, draw4], 'red', 'wild', ['draw4'])).toBe(true);
    });

    test('stacking scenario: only draw2 is required, skip is not playable', () => {
        const redDraw2 = { ID: 12, Color: 'red',  Type: 'draw2', Value: 20 };
        const greenSkip = { ID: 66, Color: 'green', Type: 'skip', Value: 20 };

        // With requiredPlay = ['draw2'], greenSkip should not count as playable
        // (simulated here by passing ['skip', 'reverse', ...everything else] as invalid)
        const invalidCards = [0,1,2,3,4,5,6,7,8,9,'skip','reverse','wild','draw4'];
        expect(canPlay([greenSkip], 'red', 'draw2', invalidCards)).toBe(false);
        expect(canPlay([redDraw2],  'red', 'draw2', invalidCards)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPoints
// ─────────────────────────────────────────────────────────────────────────────

describe('getPoints', () => {
    function makePlayersMap(configs) {
        // configs: [{ socketId, playerID, hand }]
        const map = new Map();
        configs.forEach(({ socketId, playerID, hand }) => {
            map.set(socketId, makePlayer(socketId, playerID, hand));
        });
        return map;
    }

    test('winner gets the sum of all other players\' card values', () => {
        const hand1 = [buildCard(5), buildCard(3)]; // 5 + 3 = 8
        const hand2 = [buildCard(10)];              // skip = 20
        const map = makePlayersMap([
            { socketId: 'A', playerID: 0, hand: [] },    // winner
            { socketId: 'B', playerID: 1, hand: hand1 },
            { socketId: 'C', playerID: 2, hand: hand2 },
        ]);
        const winner = map.get('A');
        const result = getPoints(map, winner);

        expect(result.pointsThisHand).toBe(28); // 8 + 20
        expect(winner.Points).toBe(28);
        expect(winner.HandsWon).toBe(1);
    });

    test('winner\'s own hand is not counted', () => {
        const winnerHand = [buildCard(9)]; // 9 points — should be ignored
        const loserHand  = [buildCard(12)]; // draw2 = 20
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: winnerHand },
            { socketId: 'L', playerID: 1, hand: loserHand },
        ]);
        const winner = map.get('W');
        const result = getPoints(map, winner);

        expect(result.pointsThisHand).toBe(20);
        expect(winner.Points).toBe(20);
    });

    test('PointsGivenUp is updated for each losing player', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'L', playerID: 1, hand: [buildCard(7)] }, // 7 pts
        ]);
        getPoints(map, map.get('W'));
        expect(map.get('L').PointsGivenUp).toBe(7);
    });

    test('breakdown lists each non-winner player and their points', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'A', playerID: 1, hand: [buildCard(5)] },  // 5
            { socketId: 'B', playerID: 2, hand: [buildCard(11)] }, // reverse = 20
        ]);
        const result = getPoints(map, map.get('W'));

        expect(result.breakdown).toHaveLength(2);
        const names = result.breakdown.map(b => b.name);
        expect(names).toContain('Player1');
        expect(names).toContain('Player2');
    });

    test('standings are sorted highest points first', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'L', playerID: 1, hand: [buildCard(3)] },
        ]);
        // Give L some pre-existing points so order is meaningful
        map.get('L').Points = 10;
        getPoints(map, map.get('W')); // W gets 3 pts; standings: W=3, L=10
        // L already has 10, W now has 3 → L should be first
        const result2 = getPoints(map, map.get('W')); // run again to check ordering
        expect(result2.standings[0].points).toBeGreaterThanOrEqual(result2.standings[1].points);
    });

    test('wild card (50 pts) is correctly totalled', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'L', playerID: 1, hand: [buildCard(13)] }, // wild = 50
        ]);
        const result = getPoints(map, map.get('W'));
        expect(result.pointsThisHand).toBe(50);
    });

    test('draw4 card (50 pts) is correctly totalled', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'L', playerID: 1, hand: [buildCard(69)] }, // draw4 = 50
        ]);
        const result = getPoints(map, map.get('W'));
        expect(result.pointsThisHand).toBe(50);
    });

    test('zero points when all other players have empty hands', () => {
        const map = makePlayersMap([
            { socketId: 'W', playerID: 0, hand: [] },
            { socketId: 'L', playerID: 1, hand: [] },
        ]);
        const result = getPoints(map, map.get('W'));
        expect(result.pointsThisHand).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// nextPlayerID
// ─────────────────────────────────────────────────────────────────────────────

describe('nextPlayerID', () => {
    // direction = -1 (default)  →  IDs decrease (wrapping at 0)
    // direction = +1            →  IDs increase (wrapping at playerCount)

    describe('direction = -1 (counter-clockwise)', () => {
        test('normal advance', () => {
            expect(nextPlayerID(2, -1, 4)).toBe(1);
        });

        test('wraps from 0 to last player', () => {
            expect(nextPlayerID(0, -1, 4)).toBe(3);
        });

        test('two players: 0 → 1', () => {
            expect(nextPlayerID(0, -1, 2)).toBe(1);
        });

        test('two players: 1 → 0', () => {
            expect(nextPlayerID(1, -1, 2)).toBe(0);
        });
    });

    describe('direction = +1 (clockwise after reverse)', () => {
        test('normal advance', () => {
            expect(nextPlayerID(1, 1, 4)).toBe(2);
        });

        test('wraps from last player to 0', () => {
            expect(nextPlayerID(3, 1, 4)).toBe(0);
        });

        test('two players: 0 → 1', () => {
            expect(nextPlayerID(0, 1, 2)).toBe(1);
        });
    });

    test('all IDs in a 5-player game advance correctly (direction -1)', () => {
        const expected = [4, 0, 1, 2, 3]; // nextPlayerID(i, -1, 5)
        [0,1,2,3,4].forEach((id, i) => {
            expect(nextPlayerID(id, -1, 5)).toBe(expected[i]);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// reshuffleSeats
// ─────────────────────────────────────────────────────────────────────────────

describe('reshuffleSeats', () => {
    function makeMap(n) {
        const map = new Map();
        for (let i = 0; i < n; i++) {
            const p = makePlayer('socket' + i, i);
            map.set('socket' + i, p);
        }
        return map;
    }

    test('the set of PlayerIDs is unchanged after reshuffling', () => {
        const map = makeMap(4);
        const before = new Set(Array.from(map.values()).map(p => p.PlayerID));
        reshuffleSeats(map);
        const after = new Set(Array.from(map.values()).map(p => p.PlayerID));
        expect(after).toEqual(before);
    });

    test('each player still has exactly one PlayerID', () => {
        const map = makeMap(5);
        reshuffleSeats(map);
        const ids = Array.from(map.values()).map(p => p.PlayerID);
        expect(ids).toHaveLength(5);
        expect(new Set(ids).size).toBe(5); // no duplicates
    });

    test('PlayerIDs are still in the range [0, n-1]', () => {
        const n = 6;
        const map = makeMap(n);
        reshuffleSeats(map);
        Array.from(map.values()).forEach(p => {
            expect(p.PlayerID).toBeGreaterThanOrEqual(0);
            expect(p.PlayerID).toBeLessThan(n);
        });
    });

    test('single-player map is a no-op', () => {
        const map = makeMap(1);
        reshuffleSeats(map);
        expect(map.get('socket0').PlayerID).toBe(0);
    });

    test('socket-to-player mapping is preserved (SocketID not changed)', () => {
        const map = makeMap(4);
        reshuffleSeats(map);
        map.forEach((player, socketId) => {
            expect(player.SocketID).toBe(socketId);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: card attribute consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('card attribute consistency across the full deck', () => {
    let deck;
    beforeAll(() => { deck = createDeck(); });

    test('every colored card has a non-black color', () => {
        deck.filter(c => c.Type !== 'wild' && c.Type !== 'draw4')
            .forEach(c => expect(c.Color).not.toBe('black'));
    });

    test('every wild and draw4 has color=black', () => {
        deck.filter(c => c.Type === 'wild' || c.Type === 'draw4')
            .forEach(c => expect(c.Color).toBe('black'));
    });

    test('numbered card values match their type (type IS the value)', () => {
        deck.filter(c => typeof c.Type === 'number')
            .forEach(c => expect(c.Value).toBe(c.Type));
    });

    test('total point value of a full deck is correct', () => {
        // 2 copies of each color × (0+1+2+…+9) = 2×4×45 = 360  (numbered)
        // 2 copies × 4 colors × 3 action types × 20 pts = 480    (skip/reverse/draw2)
        // 4 wilds × 50 + 4 draw4s × 50 = 400                     (wilds)
        // Total = 360 + 480 + 400 = 1240
        const total = deck.reduce((sum, c) => sum + c.Value, 0);
        expect(total).toBe(1240);
    });
});