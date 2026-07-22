const pointSystem = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78];
const rowsConfig = [
    { id: 'red', numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    { id: 'yellow', numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
    { id: 'green', numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] },
    { id: 'blue', numbers: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] }
];

let moveHistory = [];
let myTotalScore = 0;

// --- SISTEMA MULTIJUGADOR MQTT ---
let mqttClient = null;
let myId = Math.random().toString(36).substr(2, 9);
let currentRoom = null;
let playersData = {};
let myName = "Jugador";

function renderBoard() {
    const boardElement = document.getElementById('game-board');
    boardElement.innerHTML = '';
    rowsConfig.forEach(rowConfig => {
        const rowDiv = document.createElement('div');
        rowDiv.className = `row ${rowConfig.id}`;
        rowConfig.numbers.forEach((num, index) => {
            const box = document.createElement('div');
            box.className = 'box'; box.textContent = num;
            box.addEventListener('click', () => handleBoxClick(rowConfig.id, index));
            rowDiv.appendChild(box);
        });
        const lockBox = document.createElement('div');
        lockBox.className = 'box lock'; lockBox.textContent = '🔒';
        lockBox.addEventListener('click', () => handleBoxClick(rowConfig.id, 11));
        rowDiv.appendChild(lockBox);
        boardElement.appendChild(rowDiv);
    });
    updateVisuals();
}

function handleBoxClick(color, index) {
    const moveId = `${color}-${index}`;
    const posInHistory = moveHistory.indexOf(moveId);
    
    if (posInHistory !== -1) {
        if (posInHistory >= moveHistory.length - 1) { 
            moveHistory.splice(posInHistory, 1);
            updateVisuals(); calculateScores();
        }
    } else {
        let max = -1;
        moveHistory.forEach(m => { if(m.startsWith(color+'-')) max = Math.max(max, parseInt(m.split('-')[1])); });
        if (index > max) {
            moveHistory.push(moveId);
            updateVisuals(); calculateScores();
        }
    }
}

function handlePenaltyClick(index) {
    const moveId = `penalty-${index}`;
    const posInHistory = moveHistory.indexOf(moveId);
    if (posInHistory !== -1) {
        if (posInHistory >= moveHistory.length - 1) {
            moveHistory.splice(posInHistory, 1);
            updateVisuals(); calculateScores();
        }
    } else {
        moveHistory.push(moveId);
        updateVisuals(); calculateScores();
    }
}

function updateVisuals() {
    document.querySelectorAll('.box, .penalty-box').forEach(el => el.classList.remove('marked', 'disabled', 'last-marked'));
    ['red', 'yellow', 'green', 'blue'].forEach(color => {
        let highest = -1;
        moveHistory.forEach(m => { if(m.startsWith(color+'-')) highest = Math.max(highest, parseInt(m.split('-')[1])); });
        const rowDiv = document.querySelector(`.row.${color}`);
        if (!rowDiv) return;
        rowDiv.querySelectorAll('.box').forEach((box, index) => {
            const pos = moveHistory.indexOf(`${color}-${index}`);
            if (pos !== -1) {
                box.classList.add('marked');
                if (pos < moveHistory.length - 1) box.classList.add('disabled');
                else box.classList.add('last-marked');
            } else if (index <= highest) {
                box.classList.add('disabled');
            }
        });
    });
    for (let i = 0; i < 4; i++) {
        const pos = moveHistory.indexOf(`penalty-${i}`);
        if (pos !== -1) {
            const pbox = document.getElementById(`penalty-${i}`);
            pbox.classList.add('marked');
            if (pos < moveHistory.length - 1) pbox.classList.add('disabled');
            else pbox.classList.add('last-marked');
        }
    }
}

function calculateScores() {
    let totalScore = 0;

    ['red', 'yellow', 'green', 'blue'].forEach(color => {
        const count = Math.min(moveHistory.filter(m => m.startsWith(color+'-')).length, 12);
        const pts = pointSystem[count];
        document.getElementById(`score-${color}`).textContent = pts;
        totalScore += pts;
    });
    
    const pCount = moveHistory.filter(m => m.startsWith('penalty-')).length;
    totalScore -= (pCount * 5);
    
    document.getElementById('score-total').textContent = totalScore;
    myTotalScore = totalScore;

    if (currentRoom) {
        playersData[myId] = { 
            name: myName, 
            score: myTotalScore, 
            moves: [...moveHistory]
        };
        renderLeaderboard();
        broadcastScore('sync');
    }
}

function getPlayerName() {
    let name = document.getElementById('playerName').value.trim();
    return name || "Jugador " + Math.floor(Math.random() * 100);
}

function playSolo() {
    document.getElementById('lobbyModal').style.display = 'none';
}

function showJoinModal() {
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('joinModal').style.display = 'flex';
}

function backToLobby() {
    document.getElementById('joinModal').style.display = 'none';
    document.getElementById('lobbyModal').style.display = 'flex';
}

function createRoom() {
    myName = getPlayerName();
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    connectToRoom(code);
}

function joinRoom() {
    myName = getPlayerName();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (code.length !== 4) return alert("El código debe tener 4 letras/números.");
    connectToRoom(code);
}

function connectToRoom(code) {
    showLoading("Conectando con la sala...");
    
    mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

    mqttClient.on('connect', () => {
        currentRoom = code;
        const topic = `quixx_app_xyz/room/${code}`;
        mqttClient.subscribe(topic);
        
        playersData[myId] = { name: myName, score: myTotalScore, moves: [...moveHistory] };
        
        joinSuccess(code);
        broadcastScore('join');
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.id === myId) return;

            playersData[data.id] = { 
                name: data.name, 
                score: data.score,
                moves: data.moves || []
            };
            renderLeaderboard();

            if (data.action === 'join') {
                broadcastScore('sync');
            }
        } catch(e) { console.error("Mensaje inválido", e); }
    });

    mqttClient.on('error', (err) => {
        hideLoading();
        alert("Error de red. Revisa tu internet.");
    });
}

function broadcastScore(action = 'sync') {
    if (mqttClient && currentRoom) {
        const topic = `quixx_app_xyz/room/${currentRoom}`;
        const payload = JSON.stringify({
            action: action,
            id: myId,
            name: myName,
            score: myTotalScore,
            moves: [...moveHistory]
        });
        mqttClient.publish(topic, payload);
    }
}

function joinSuccess(code) {
    hideLoading();
    document.getElementById('lobbyModal').style.display = 'none';
    document.getElementById('joinModal').style.display = 'none';
    
    const info = document.getElementById('roomInfoDisplay');
    info.style.display = 'inline-block';
    info.textContent = `SALA: ${code}`;
    
    document.getElementById('leaderboardPanel').style.display = 'flex';
    renderLeaderboard();
}

function renderLeaderboard() {
    const list = document.getElementById('playersList');
    list.innerHTML = '';
    
    const playersArr = Object.keys(playersData).map(id => ({
        id: id,
        ...playersData[id]
    })).sort((a, b) => b.score - a.score);

    playersArr.forEach(p => {
        const isMe = p.id === myId;
        const card = document.createElement('div');
        card.className = `player-card ${isMe ? 'me' : ''}`;
        
        const pMoves = p.moves || [];

        // Generar HTML para las 4 filas del mini tablero
        let boardHtml = '<div class="mini-board">';
        rowsConfig.forEach(rc => {
            boardHtml += `<div class="mini-row ${rc.id}">`;
            rc.numbers.forEach((num, idx) => {
                const isMarked = pMoves.includes(`${rc.id}-${idx}`);
                boardHtml += `<div class="mini-cell ${isMarked ? 'marked' : ''}">${num}</div>`;
            });
            const isLockMarked = pMoves.includes(`${rc.id}-11`);
            boardHtml += `<div class="mini-cell lock ${isLockMarked ? 'marked' : ''}">🔒</div>`;
            boardHtml += `</div>`;
        });
        boardHtml += '</div>';

        // Generar HTML para las fallas en miniatura
        let penaltiesHtml = '<div class="mini-penalties"><span style="font-size:10px; color:var(--text-muted); margin-right:4px;">Fallas:</span>';
        for (let i = 0; i < 4; i++) {
            const isPenMarked = pMoves.includes(`penalty-${i}`);
            penaltiesHtml += `<div class="mini-pbox ${isPenMarked ? 'marked' : ''}"></div>`;
        }
        penaltiesHtml += '</div>';

        card.innerHTML = `
            <div class="player-card-header">
                <span>${p.name}${isMe ? ' (Tú)' : ''}</span>
                <span>${p.score} pts</span>
            </div>
            ${boardHtml}
            ${penaltiesHtml}
        `;
        
        list.appendChild(card);
    });
}

// --- UTILIDADES ---
function showModal() { document.getElementById('confirmModal').style.display = 'flex'; }
function closeModal() { document.getElementById('confirmModal').style.display = 'none'; }
function confirmReset() {
    moveHistory = []; updateVisuals(); calculateScores(); closeModal();
}

function showLoading(text) {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingModal').style.display = 'flex';
}
function hideLoading() {
    document.getElementById('loadingModal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', renderBoard);