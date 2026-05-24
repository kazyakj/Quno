# Quno

A multiplayer Uno clone built with Node.js and Socket.IO.

## Getting Started

You'll need [Node.js](https://nodejs.org/) (which includes npm) installed.

1. Clone the repo and navigate into it
2. Install dependencies:
    ```bash
    npm install
    ```
3. Start the server:
    ```bash
    node server.js
    ```
4. Open your browser to `http://localhost:3000`

The prod server is https://quno.azurewebsites.net/. Changes that are merged into the `main` branch will automatically deploy there.

## Project Structure

| File | Purpose |
|---|---|
| `server.js` | Server and socket event handling — joins, turns, game flow |
| `gameLogic.js` | Pure game logic with no socket I/O — card attributes, deck creation, scoring, turn order |
| `main.js` | Client-side logic — rendering, animations, socket event handlers |
| `style.css` | Styling |
| `index.html` | Page structure |

`gameLogic.js` is the single source of truth for all pure game functions. `server.js` imports from it rather than duplicating logic.

## Running Tests

Tests cover the pure game logic in `gameLogic.js`. Install the test dependency if you haven't already:

```bash
npm install --save-dev jest
```

Then run the test suite:

```bash
npx jest
```

If you're adding or changing logic in `gameLogic.js`, add corresponding tests in `gameLogic.test.js`. Functions in `server.js` that involve socket I/O are not unit tested here.