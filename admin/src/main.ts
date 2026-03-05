const API = '/api';

// ─── Auth token management ──────────────────────────────────────────────────────

function getToken(): string | null {
  return sessionStorage.getItem('adminToken');
}

function setToken(token: string): void {
  sessionStorage.setItem('adminToken', token);
}

function clearToken(): void {
  sessionStorage.removeItem('adminToken');
}

function showLogin(): void {
  document.getElementById('login-overlay')!.classList.remove('hidden');
  document.getElementById('dashboard')!.classList.remove('visible');
}

function showDashboard(): void {
  document.getElementById('login-overlay')!.classList.add('hidden');
  document.getElementById('dashboard')!.classList.add('visible');
}

/** Wrapper around fetch that injects the auth token and handles 401s */
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && !url.includes('/api/auth/')) {
    clearToken();
    showLogin();
  }
  return res;
}

// ─── Login / Logout ─────────────────────────────────────────────────────────────

document.getElementById('login-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const passwordInput = document.getElementById('login-password') as HTMLInputElement;
  const errorEl = document.getElementById('login-error')!;
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (!res.ok) {
      errorEl.textContent = 'Invalid password';
      return;
    }
    const { token } = await res.json();
    setToken(token);
    passwordInput.value = '';
    showDashboard();
    refresh();
  } catch {
    errorEl.textContent = 'Connection failed';
  }
});

document.getElementById('logout-btn')!.addEventListener('click', async () => {
  try {
    await apiFetch(`${API}/auth/logout`, { method: 'POST' });
  } catch { /* ignore */ }
  clearToken();
  showLogin();
});

// ─── Types ───────────────────────────────────────────────────────────────────────

interface Game {
  id: string;
  name: string;
  game_type: string;
  status: string;
  small_blind: number;
  big_blind: number;
  max_players: number;
  starting_stack: number;
  spectator_visibility: string;
  showdown_visibility: string;
  tournament_length_hours: number | null;
  round_length_minutes: number | null;
  antes_enabled: number;
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
  const res = await apiFetch(`${API}/games`);
  if (!res.ok) throw new Error('Failed to fetch games');
  return res.json();
}

async function createGame(data: Record<string, unknown>) {
  const res = await apiFetch(`${API}/games`, {
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

async function pauseGame(gameId: string) {
  const res = await apiFetch(`${API}/games/${gameId}/pause`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to pause game');
  }
}

async function resumeGame(gameId: string) {
  const res = await apiFetch(`${API}/games/${gameId}/resume`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to resume game');
  }
}

async function startGame(gameId: string) {
  const res = await apiFetch(`${API}/games/${gameId}/start`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start game');
  }
}

async function setSpectatorVisibility(gameId: string, visibility: string) {
  const res = await apiFetch(`${API}/games/${gameId}/spectator-visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spectatorVisibility: visibility }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update spectator mode');
  }
}

async function setShowdownVisibility(gameId: string, visibility: string) {
  const res = await apiFetch(`${API}/games/${gameId}/showdown-visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showdownVisibility: visibility }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update showdown mode');
  }
}

async function deleteGame(gameId: string) {
  const res = await apiFetch(`${API}/games/${gameId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete game');
  }
}

async function addBot(gameId: string, botType: string) {
  const res = await apiFetch(`${API}/games/${gameId}/add-bot`, {
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

// ─── Replay API calls ────────────────────────────────────────────────────────────

interface ReplayInfo {
  gameId: string;
  gameName: string;
  filePath: string;
  createdAt: string;
}

async function fetchReplays(): Promise<ReplayInfo[]> {
  const res = await apiFetch(`${API}/replays`);
  if (!res.ok) throw new Error('Failed to fetch replays');
  return res.json();
}

async function createReplayGame(filePath: string): Promise<{ replayGameId: string }> {
  const res = await apiFetch(`${API}/replays/create-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create replay game');
  }
  return res.json();
}

async function uploadReplayFile(data: unknown): Promise<void> {
  const res = await apiFetch(`${API}/replays/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to upload replay');
  }
}

// ─── Auth management API calls ──────────────────────────────────────────────────

interface AuthSettings {
  privateMode: boolean;
  serverPassphrase: string | null;
}

interface PlayerPassphrase {
  id: string;
  passphrase: string;
  label: string | null;
  used_by_player_id: string | null;
  used_at: string | null;
  revoked: number;
  created_at: string;
}

interface InviteCode {
  id: string;
  code: string;
  game_id: string;
  label: string | null;
  used_by_player_id: string | null;
  used_at: string | null;
  revoked: number;
  created_at: string;
}

async function fetchAuthSettings(): Promise<AuthSettings> {
  const res = await apiFetch(`${API}/auth/server-settings`);
  if (!res.ok) throw new Error('Failed to fetch auth settings');
  return res.json();
}

async function updateAuthSettings(data: Partial<AuthSettings>) {
  const res = await apiFetch(`${API}/auth/server-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update auth settings');
  return res.json();
}

async function fetchPassphrases(): Promise<PlayerPassphrase[]> {
  const res = await apiFetch(`${API}/auth/passphrases`);
  if (!res.ok) throw new Error('Failed to fetch passphrases');
  return res.json();
}

async function generatePassphrase(label?: string): Promise<PlayerPassphrase> {
  const res = await apiFetch(`${API}/auth/passphrases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error('Failed to generate passphrase');
  return res.json();
}

async function revokePassphrase(id: string) {
  const res = await apiFetch(`${API}/auth/passphrases/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to revoke passphrase');
}

async function fetchInviteCodes(): Promise<InviteCode[]> {
  const res = await apiFetch(`${API}/auth/invite-codes`);
  if (!res.ok) throw new Error('Failed to fetch invite codes');
  return res.json();
}

async function generateInviteCode(gameId: string, label?: string): Promise<InviteCode> {
  const res = await apiFetch(`${API}/auth/invite-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, label }),
  });
  if (!res.ok) throw new Error('Failed to generate invite code');
  return res.json();
}

async function revokeInviteCodeApi(id: string) {
  const res = await apiFetch(`${API}/auth/invite-codes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to revoke invite code');
}

async function revokeAllTokens() {
  const res = await apiFetch(`${API}/auth/tokens`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to revoke all tokens');
}

// ─── Auth management render ─────────────────────────────────────────────────────

function renderAuthSettings(settings: AuthSettings) {
  const privateModeEl = document.getElementById('private-mode') as HTMLInputElement;
  const passphraseEl = document.getElementById('server-passphrase') as HTMLInputElement;
  privateModeEl.checked = settings.privateMode;
  passphraseEl.value = settings.serverPassphrase ?? '';
}

function renderPassphrases(passphrases: PlayerPassphrase[]) {
  const container = document.getElementById('passphrases-container')!;
  if (passphrases.length === 0) {
    container.innerHTML = '<em style="color:#666">No passphrases generated yet.</em>';
    return;
  }
  container.innerHTML = `<table><thead><tr>
    <th>Label</th><th>Passphrase</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>${passphrases.map(p => {
    const status = p.revoked ? '<span style="color:#dc2626">Revoked</span>'
      : p.used_by_player_id ? `<span style="color:#22c55e">Used</span>`
      : '<span style="color:#f59e0b">Unused</span>';
    const canRevoke = !p.revoked && !p.used_by_player_id;
    return `<tr>
      <td>${esc(p.label ?? '-')}</td>
      <td><code>${esc(p.passphrase)}</code> <button class="secondary" style="padding:0.2rem 0.4rem;font-size:0.75rem;" onclick="window.__copyText('${esc(p.passphrase)}')">Copy</button></td>
      <td>${status}</td>
      <td>${canRevoke ? `<button class="danger" onclick="window.__revokePassphrase('${p.id}')">Revoke</button>` : ''}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

function renderInviteCodes(codes: InviteCode[], games: Game[]) {
  const container = document.getElementById('invite-codes-container')!;
  if (codes.length === 0) {
    container.innerHTML = '<em style="color:#666">No invite codes generated yet.</em>';
    return;
  }
  const gameMap = new Map(games.map(g => [g.id, g.name]));
  container.innerHTML = `<table><thead><tr>
    <th>Game</th><th>Label</th><th>Code</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>${codes.map(c => {
    const status = c.revoked ? '<span style="color:#dc2626">Revoked</span>'
      : c.used_by_player_id ? `<span style="color:#22c55e">Used</span>`
      : '<span style="color:#f59e0b">Unused</span>';
    const canRevoke = !c.revoked && !c.used_by_player_id;
    return `<tr>
      <td>${esc(gameMap.get(c.game_id) ?? c.game_id.slice(0, 8))}</td>
      <td>${esc(c.label ?? '-')}</td>
      <td><code>${esc(c.code)}</code> <button class="secondary" style="padding:0.2rem 0.4rem;font-size:0.75rem;" onclick="window.__copyText('${esc(c.code)}')">Copy</button></td>
      <td>${status}</td>
      <td>${canRevoke ? `<button class="danger" onclick="window.__revokeInviteCode('${c.id}')">Revoke</button>` : ''}</td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

function updateGameSelect(games: Game[]) {
  const select = document.getElementById('ic-game-select') as HTMLSelectElement;
  const activeGames = games.filter(g => g.status === 'waiting' || g.status === 'in_progress');
  select.innerHTML = activeGames.length === 0
    ? '<option value="">No active games</option>'
    : activeGames.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
}

// ─── Render ─────────────────────────────────────────────────────────────────────

function renderGames(games: Game[]) {
  const container = document.getElementById('games-container')!;

  if (games.length === 0) {
    container.innerHTML = '<em style="color:#666">No games yet. Create one above.</em>';
    return;
  }

  const specLabel = (v: string) =>
    v === 'showdown' ? 'Showdown' : v === 'delayed' ? 'Delayed' : 'Public';

  const typeLabel = (g: Game) =>
    g.game_type === 'tournament' ? 'SNG' : 'Cash';

  const tourneyInfo = (g: Game) =>
    g.game_type === 'tournament' && g.tournament_length_hours != null
      ? `<div style="font-size:0.75rem;color:#888">${g.tournament_length_hours}h / ${g.round_length_minutes}m${g.antes_enabled ? ' +antes' : ''}</div>`
      : '';

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Blinds</th>
          <th>Stack</th>
          <th>Players</th>
          <th>Status</th>
          <th>Spectator</th>
          <th>Showdown</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${games
          .map(
            (g) => `
          <tr>
            <td>${esc(g.name)}${tourneyInfo(g)}</td>
            <td>${typeLabel(g)}</td>
            <td>${g.small_blind}/${g.big_blind}</td>
            <td>${g.starting_stack}</td>
            <td>${g.playerCount ?? 0}/${g.max_players}</td>
            <td><span class="status-${g.status}">${g.status}</span></td>
            <td>
              ${
                g.status === 'waiting' || g.status === 'in_progress'
                  ? `<select id="spec-${g.id}" class="spec-select">
                       <option value="showdown"${g.spectator_visibility === 'showdown' ? ' selected' : ''}>Showdown</option>
                       <option value="delayed"${g.spectator_visibility === 'delayed' ? ' selected' : ''}>Delayed</option>
                       <option value="immediate"${g.spectator_visibility === 'immediate' ? ' selected' : ''}>Public</option>
                     </select>
                     <button class="secondary" onclick="window.__setSpec('${g.id}')">Set</button>`
                  : esc(specLabel(g.spectator_visibility ?? 'showdown'))
              }
            </td>
            <td>
              ${
                g.status === 'waiting' || g.status === 'in_progress'
                  ? `<select id="showdown-${g.id}" class="spec-select">
                       <option value="standard"${(g.showdown_visibility ?? 'standard') === 'standard' ? ' selected' : ''}>Standard</option>
                       <option value="show-all"${g.showdown_visibility === 'show-all' ? ' selected' : ''}>Show All</option>
                     </select>
                     <button class="secondary" onclick="window.__setShowdown('${g.id}')">Set</button>`
                  : esc(g.showdown_visibility === 'show-all' ? 'Show All' : 'Standard')
              }
            </td>
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
              ${
                g.status === 'in_progress' && g.game_type === 'tournament'
                  ? `<button class="secondary" onclick="window.__pauseGame('${g.id}')">Pause</button>
                     <button class="secondary" onclick="window.__resumeGame('${g.id}')">Resume</button>`
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

function renderReplays(replays: ReplayInfo[]) {
  const container = document.getElementById('replays-container')!;

  if (replays.length === 0) {
    container.innerHTML = '<em style="color:#666">No replay files. Complete a game to generate one.</em>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Game Name</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${replays
          .map(
            (r) => `
          <tr>
            <td>${esc(r.gameName)}</td>
            <td>${new Date(r.createdAt).toLocaleString()}</td>
            <td class="actions">
              <button class="secondary" onclick="window.__launchReplay('${esc(r.filePath.replace(/\\/g, '\\\\'))}')">Launch Replay</button>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

// ─── Event handlers ─────────────────────────────────────────────────────────────

async function refresh() {
  try {
    const [games, replays, authSettings, passphrases, inviteCodes] = await Promise.all([
      fetchGames(),
      fetchReplays(),
      fetchAuthSettings(),
      fetchPassphrases(),
      fetchInviteCodes(),
    ]);
    renderGames(games);
    renderReplays(replays);
    renderAuthSettings(authSettings);
    renderPassphrases(passphrases);
    renderInviteCodes(inviteCodes, games);
    updateGameSelect(games);
  } catch (err) {
    toast('Failed to load data', true);
  }
}

// Toggle cash/tournament form fields
document.getElementById('gameType')!.addEventListener('change', (e) => {
  const isTournament = (e.target as HTMLSelectElement).value === 'tournament';
  document.getElementById('cash-fields')!.style.display = isTournament ? 'none' : '';
  document.getElementById('tournament-fields')!.style.display = isTournament ? '' : 'none';
});

document.getElementById('create-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const gameType = (form.elements.namedItem('gameType') as HTMLSelectElement).value;

  let data: Record<string, unknown>;

  if (gameType === 'tournament') {
    data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      gameType: 'tournament',
      smallBlind: 25,
      bigBlind: 50,
      startingStack: 5000,
      maxPlayers: parseInt((form.elements.namedItem('tournamentMaxPlayers') as HTMLInputElement).value, 10),
      spectatorVisibility: (form.elements.namedItem('spectatorVisibility') as HTMLSelectElement).value,
      showdownVisibility: (form.elements.namedItem('showdownVisibility') as HTMLSelectElement).value,
      tournamentLengthHours: parseFloat((form.elements.namedItem('tournamentLengthHours') as HTMLInputElement).value),
      roundLengthMinutes: parseInt((form.elements.namedItem('roundLengthMinutes') as HTMLInputElement).value, 10),
      antesEnabled: (form.elements.namedItem('antesEnabled') as HTMLInputElement).checked,
    };
  } else {
    data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      gameType: 'cash',
      smallBlind: parseInt((form.elements.namedItem('smallBlind') as HTMLInputElement).value, 10),
      bigBlind: parseInt((form.elements.namedItem('bigBlind') as HTMLInputElement).value, 10),
      startingStack: parseInt((form.elements.namedItem('startingStack') as HTMLInputElement).value, 10),
      maxPlayers: parseInt((form.elements.namedItem('maxPlayers') as HTMLInputElement).value, 10),
      spectatorVisibility: (form.elements.namedItem('spectatorVisibility') as HTMLSelectElement).value,
      showdownVisibility: (form.elements.namedItem('showdownVisibility') as HTMLSelectElement).value,
    };
  }

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

(window as any).__setSpec = async (id: string) => {
  const select = document.getElementById(`spec-${id}`) as HTMLSelectElement;
  const visibility = select?.value ?? 'showdown';
  try {
    await setSpectatorVisibility(id, visibility);
    toast('Spectator mode updated');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__setShowdown = async (id: string) => {
  const select = document.getElementById(`showdown-${id}`) as HTMLSelectElement;
  const visibility = select?.value ?? 'standard';
  try {
    await setShowdownVisibility(id, visibility);
    toast('Showdown mode updated');
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

(window as any).__pauseGame = async (id: string) => {
  try {
    await pauseGame(id);
    toast('Tournament paused');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__resumeGame = async (id: string) => {
  try {
    await resumeGame(id);
    toast('Tournament resumed');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__launchReplay = async (filePath: string) => {
  try {
    const result = await createReplayGame(filePath);
    toast(`Replay game created: ${result.replayGameId}`);
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

// Replay file upload
document.getElementById('replay-upload')?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await uploadReplayFile(data);
    toast('Replay uploaded');
    input.value = '';
    refresh();
  } catch (err: any) {
    toast(err.message || 'Failed to upload replay', true);
  }
});

// ─── Auth management event handlers ─────────────────────────────────────────────

document.getElementById('private-mode')!.addEventListener('change', async (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  try {
    await updateAuthSettings({ privateMode: checked });
    toast(checked ? 'Private mode enabled' : 'Private mode disabled');
  } catch (err: any) {
    toast(err.message, true);
    refresh();
  }
});

document.getElementById('set-passphrase-btn')!.addEventListener('click', async () => {
  const input = document.getElementById('server-passphrase') as HTMLInputElement;
  const value = input.value.trim();
  if (!value) {
    toast('Enter a passphrase first', true);
    return;
  }
  try {
    await updateAuthSettings({ serverPassphrase: value });
    toast('Server passphrase set');
  } catch (err: any) {
    toast(err.message, true);
  }
});

document.getElementById('clear-passphrase-btn')!.addEventListener('click', async () => {
  try {
    await updateAuthSettings({ serverPassphrase: null });
    toast('Server passphrase cleared');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
});

document.getElementById('gen-pp-btn')!.addEventListener('click', async () => {
  const labelInput = document.getElementById('pp-label') as HTMLInputElement;
  const label = labelInput.value.trim() || undefined;
  try {
    const pp = await generatePassphrase(label);
    toast(`Passphrase generated: ${pp.passphrase}`);
    labelInput.value = '';
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
});

document.getElementById('gen-ic-btn')!.addEventListener('click', async () => {
  const gameSelect = document.getElementById('ic-game-select') as HTMLSelectElement;
  const labelInput = document.getElementById('ic-label') as HTMLInputElement;
  const gameId = gameSelect.value;
  if (!gameId) {
    toast('Select a game first', true);
    return;
  }
  const label = labelInput.value.trim() || undefined;
  try {
    const ic = await generateInviteCode(gameId, label);
    toast(`Invite code generated: ${ic.code}`);
    labelInput.value = '';
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
});

document.getElementById('revoke-all-btn')!.addEventListener('click', async () => {
  if (!confirm('Are you sure? This will force ALL players to re-authenticate.')) return;
  try {
    await revokeAllTokens();
    toast('All auth sessions revoked');
  } catch (err: any) {
    toast(err.message, true);
  }
});

(window as any).__copyText = (text: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard'),
    () => toast('Failed to copy', true),
  );
};

(window as any).__revokePassphrase = async (id: string) => {
  try {
    await revokePassphrase(id);
    toast('Passphrase revoked');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

(window as any).__revokeInviteCode = async (id: string) => {
  try {
    await revokeInviteCodeApi(id);
    toast('Invite code revoked');
    refresh();
  } catch (err: any) {
    toast(err.message, true);
  }
};

// ─── Init: check auth state ─────────────────────────────────────────────────────

async function init() {
  const token = getToken();
  if (token) {
    try {
      const res = await fetch(`${API}/auth/check`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        showDashboard();
        refresh();
        setInterval(refresh, 5000);
        return;
      }
    } catch { /* server unreachable */ }
  }
  clearToken();
  showLogin();
}

init();
