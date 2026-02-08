const API = '/api';

interface Game {
  id: string;
  name: string;
  game_type: string;
  status: string;
  small_blind: number;
  big_blind: number;
  max_players: number;
  starting_stack: number;
  playerCount: number;
  created_at: string;
}

// ─── Toast ──────────────────────────────────────────────────────────────────────

function toast(message: string, isError = false) {
  const el = document.getElementById('toast')!;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── API calls ──────────────────────────────────────────────────────────────────

async function fetchGames(): Promise<Game[]> {
  const res = await fetch(`${API}/games`);
  if (!res.ok) throw new Error('Failed to fetch games');
  return res.json();
}

async function createGame(data: {
  name: string;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  maxPlayers: number;
}) {
  const res = await fetch(`${API}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create game');
  }
  return res.json();
}

async function startGame(gameId: string) {
  const res = await fetch(`${API}/games/${gameId}/start`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start game');
  }
}

async function deleteGame(gameId: string) {
  const res = await fetch(`${API}/games/${gameId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete game');
  }
}

async function addBot(gameId: string, botType: string) {
  const res = await fetch(`${API}/games/${gameId}/add-bot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add bot');
  }
  return res.json();
}

// ─── Render ─────────────────────────────────────────────────────────────────────

function renderGames(games: Game[]) {
  const container = document.getElementById('games-container')!;

  if (games.length === 0) {
    container.innerHTML = '<em style="color:#666">No games yet. Create one above.</em>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Blinds</th>
          <th>Stack</th>
          <th>Players</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${games
          .map(
            (g) => `
          <tr>
            <td>${esc(g.name)}</td>
            <td>${g.small_blind}/${g.big_blind}</td>
            <td>${g.starting_stack}</td>
            <td>${g.playerCount ?? 0}/${g.max_players}</td>
            <td><span class="status-${g.status}">${g.status}</span></td>
            <td class="actions">
              ${
                g.status === 'waiting'
                  ? `<select id="bot-type-${g.id}" class="bot-select">
                       <option value="calling-station">Calling Station</option>
                       <option value="tag-bot">TAG Bot</option>
                     </select>
                     <button class="secondary" onclick="window.__addBot('${g.id}')">+ Bot</button>
                     <button class="secondary" onclick="window.__startGame('${g.id}')">Start</button>
                     <button class="danger" onclick="window.__deleteGame('${g.id}')">Delete</button>`
                  : ''
              }
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ─── Event handlers ─────────────────────────────────────────────────────────────

async function refresh() {
  try {
    const games = await fetchGames();
    renderGames(games);
  } catch (err) {
    toast('Failed to load games', true);
  }
}

document.getElementById('create-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = {
    name: (form.elements.namedItem('name') as HTMLInputElement).value,
    smallBlind: parseInt((form.elements.namedItem('smallBlind') as HTMLInputElement).value, 10),
    bigBlind: parseInt((form.elements.namedItem('bigBlind') as HTMLInputElement).value, 10),
    startingStack: parseInt(
      (form.elements.namedItem('startingStack') as HTMLInputElement).value,
      10
    ),
    maxPlayers: parseInt((form.elements.namedItem('maxPlayers') as HTMLInputElement).value, 10),
  };

  try {
    await createGame(data);
    toast('Game created');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
});

// Expose to onclick handlers
(window as any).__startGame = async (id: string) => {
  try {
    await startGame(id);
    toast('Game started');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__addBot = async (id: string) => {
  const select = document.getElementById(`bot-type-${id}`) as HTMLSelectElement;
  const botType = select?.value ?? 'calling-station';
  try {
    await addBot(id, botType);
    toast(`${botType} bot added`);
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__deleteGame = async (id: string) => {
  try {
    await deleteGame(id);
    toast('Game deleted');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

// Auto-refresh every 5s
refresh();
setInterval(refresh, 5000);
