document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const defaultState = {
        players: [],
        currentRound: 1,
        totalRounds: 10,
        currentPlayerIndex: 0,
        currentQuestion: null,
        playerAnswers: {},
        gameActive: false,
        config: {
            playerCount: 2,
            category: 'General Knowledge',
            difficulty: 'Medium'
        }
    };

    let state = loadState() || defaultState;

    function loadState() {
        const saved = localStorage.getItem('eot_state');
        return saved ? JSON.parse(saved) : null;
    }

    function saveState() {
        localStorage.setItem('eot_state', JSON.stringify(state));
    }

    function resetState() {
        state = JSON.parse(JSON.stringify(defaultState));
        saveState();
    }

    // --- IndexedDB ---
    const DB_NAME = 'EOT_DB';
    const STORE_NAME = 'questions';
    let db = null;

    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject("DB Error");
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    async function clearDB() {
        return new Promise((resolve, reject) => {
            if (db) db.close();
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => {
                db = null;
                resolve();
            };
            request.onerror = () => reject("Error deleting DB");
        });
    }

    async function storeQuestions(questions) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            questions.forEach(q => store.add(q));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject();
        });
    }

    async function getQuestion(index) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(index);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject();
        });
    }

    // --- Audio ---
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playSound(type) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;

        if (type === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === 'start') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        }
    }

    // --- Page Logic ---
    const path = window.location.pathname;

    if (path === '/') {
        initLanding();
    } else if (path === '/setup') {
        initSetup();
    } else if (path === '/loading') {
        initLoading();
    } else if (path === '/game') {
        initGame();
    } else if (path === '/results') {
        initResults();
    }

    // --- Landing ---
    function initLanding() {
        const btn = document.getElementById('landing-start-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                playSound('start');
                resetState(); // Start fresh
                window.location.href = '/setup';
            });
        }
    }

    // --- Setup ---
    function initSetup() {
        const countBtns = document.querySelectorAll('.count-btn');
        const namesContainer = document.getElementById('player-names-container');
        const startBtn = document.getElementById('start-game-btn');
        const categorySelect = document.getElementById('category-select');
        const difficultySelect = document.getElementById('difficulty-select');

        function renderNameInputs() {
            namesContainer.innerHTML = '';
            for (let i = 1; i <= state.config.playerCount; i++) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'player-name-input';
                input.placeholder = `Player ${i} Name`;
                input.dataset.id = i;
                input.value = `Player ${i}`;
                namesContainer.appendChild(input);
            }
        }

        // Restore previous selection if any
        countBtns.forEach(btn => {
            if (parseInt(btn.dataset.value) === state.config.playerCount) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }

            btn.addEventListener('click', () => {
                playSound('click');
                countBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.config.playerCount = parseInt(btn.dataset.value);
                renderNameInputs();
                saveState();
            });
        });

        renderNameInputs();

        startBtn.addEventListener('click', () => {
            playSound('start');
            state.config.category = categorySelect.value;
            state.config.difficulty = difficultySelect.value;

            state.players = [];
            const inputs = namesContainer.querySelectorAll('input');
            inputs.forEach(input => {
                state.players.push({
                    id: parseInt(input.dataset.id),
                    name: input.value || `Player ${input.dataset.id}`,
                    score: 0,
                    tokens: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
                });
            });

            saveState();
            window.location.href = '/loading';
        });
    }

    // --- Loading ---
    async function initLoading() {
        const status = document.getElementById('loading-status');
        const progress = document.getElementById('loading-progress');

        const loadingMessages = [
            "Consulting the Oracle...",
            "Gathering Cosmic Knowledge...",
            "Aligning the Stars...",
            "Fetching Questions...",
            "Preparing the Arena..."
        ];

        let msgIndex = 0;
        status.textContent = loadingMessages[0];

        const msgInterval = setInterval(() => {
            msgIndex = (msgIndex + 1) % loadingMessages.length;
            status.textContent = loadingMessages[msgIndex];
        }, 800);

        await initDB();
        await clearDB(); // Clear old questions
        await initDB(); // Re-open

        try {
            progress.style.width = "20%";
            progress.textContent = "20%";

            const response = await fetch('/api/generate_question', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: state.config.category,
                    difficulty: state.config.difficulty,
                    count: 10
                })
            });

            progress.style.width = "60%";
            progress.textContent = "60%";

            const questions = await response.json();
            if (questions.error) throw new Error(questions.error);

            status.textContent = "Storing Knowledge...";
            await storeQuestions(questions);

            progress.style.width = "100%";
            progress.textContent = "100%";

            clearInterval(msgInterval);
            setTimeout(() => {
                window.location.href = '/game';
            }, 500);

        } catch (error) {
            clearInterval(msgInterval);
            console.error(error);
            status.textContent = "Error: " + error.message;
        }
    }

    // --- Game ---
    async function initGame() {
        await initDB();

        const els = {
            round: document.getElementById('current-round'),
            category: document.getElementById('game-category-display'),
            questionText: document.getElementById('question-text'),
            options: document.querySelectorAll('.option-btn'),
            playerName: document.getElementById('current-player-name'),
            tokenGrid: document.getElementById('token-grid'),
            confirmBtn: document.getElementById('confirm-turn-btn'),
            scoreList: document.getElementById('score-list'),
            popup: {
                overlay: document.getElementById('reveal-popup'),
                correct: document.getElementById('popup-correct-option'),
                explanation: document.getElementById('popup-explanation'),
                nextBtn: document.getElementById('popup-next-btn')
            }
        };

        els.category.textContent = state.config.category;
        updateScoreboard();
        loadRound();

        function updateScoreboard() {
            els.scoreList.innerHTML = '';
            state.players.forEach((p, idx) => {
                const li = document.createElement('li');
                li.className = 'score-item';
                if (idx === state.currentPlayerIndex && els.popup.overlay.classList.contains('hidden')) {
                    li.classList.add('active-turn');
                }
                li.innerHTML = `<span>${p.name}</span> <span>${p.score} pts</span>`;
                els.scoreList.appendChild(li);
            });
        }

        async function loadRound() {
            els.popup.overlay.classList.add('hidden');
            els.round.textContent = state.currentRound;
            state.playerAnswers = {};
            state.currentPlayerIndex = 0;
            saveState();

            try {
                const question = await getQuestion(state.currentRound);
                if (!question) throw new Error("Question not found");
                state.currentQuestion = question;
                displayQuestion();
            } catch (e) {
                console.error(e);
            }
        }

        function displayQuestion() {
            els.questionText.textContent = state.currentQuestion.question;
            const opts = state.currentQuestion.options;
            const questionType = state.currentQuestion.type || 'mcq';

            // Determine how many options to show
            const optionKeys = Object.keys(opts);

            // Show/hide options based on question type
            els.options.forEach((btn, idx) => {
                const key = btn.dataset.option;
                if (optionKeys.includes(key)) {
                    btn.style.display = 'flex';
                    btn.querySelector('.opt-text').textContent = opts[key];
                    btn.classList.remove('selected');
                } else {
                    btn.style.display = 'none';
                }

                // Clone to remove old listeners
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
            });

            // Adjust grid layout based on number of options
            const optionsGrid = document.querySelector('.options-grid');
            if (optionKeys.length === 2) {
                // True/False or More/Less - show side by side
                optionsGrid.style.gridTemplateColumns = '1fr 1fr';
            } else {
                // MCQ or Number Line - show 2x2 grid
                optionsGrid.style.gridTemplateColumns = '1fr 1fr';
            }

            // Re-select options after cloning
            els.options = document.querySelectorAll('.option-btn');
            els.options.forEach(btn => {
                if (btn.style.display !== 'none') {
                    btn.addEventListener('click', () => {
                        playSound('click');
                        selectOption(btn.dataset.option);
                    });
                }
            });

            setupTurn();
        }

        let currentTurnSelection = { option: null, confidence: null };

        function setupTurn() {
            const player = state.players[state.currentPlayerIndex];
            els.playerName.textContent = player.name;
            els.confirmBtn.disabled = true;
            els.options.forEach(b => b.classList.remove('selected'));
            currentTurnSelection = { option: null, confidence: null };

            els.tokenGrid.innerHTML = '';
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(val => {
                const btn = document.createElement('button');
                btn.className = 'token-btn';
                btn.textContent = val;
                if (!player.tokens.includes(val)) {
                    btn.disabled = true;
                } else {
                    btn.addEventListener('click', () => {
                        currentTurnSelection.confidence = val;
                        document.querySelectorAll('.token-btn').forEach(b => b.classList.remove('selected'));
                        btn.classList.add('selected');
                        checkTurnReady();
                    });
                }
                els.tokenGrid.appendChild(btn);
            });
            updateScoreboard();
        }

        function selectOption(option) {
            currentTurnSelection.option = option;
            els.options.forEach(b => {
                b.classList.toggle('selected', b.dataset.option === option);
            });
            checkTurnReady();
        }

        function checkTurnReady() {
            els.confirmBtn.disabled = !(currentTurnSelection.option && currentTurnSelection.confidence);
        }

        els.confirmBtn.onclick = () => {
            playSound('click');
            const player = state.players[state.currentPlayerIndex];
            state.playerAnswers[player.id] = { ...currentTurnSelection };

            const tokenIndex = player.tokens.indexOf(currentTurnSelection.confidence);
            if (tokenIndex > -1) player.tokens.splice(tokenIndex, 1);

            state.currentPlayerIndex++;
            saveState();

            if (state.currentPlayerIndex < state.players.length) {
                setupTurn();
            } else {
                revealRoundResults();
            }
        };

        function revealRoundResults() {
            const correct = state.currentQuestion.correct;
            state.players.forEach(player => {
                const ans = state.playerAnswers[player.id];
                if (ans.option === correct) {
                    player.score += ans.confidence;
                }
            });
            saveState();
            updateScoreboard();

            els.popup.correct.textContent = `${correct}: ${state.currentQuestion.options[correct]}`;
            els.popup.explanation.textContent = state.currentQuestion.explanation || "";

            if (state.currentRound === state.totalRounds) {
                els.popup.nextBtn.textContent = "Get Results";
            } else {
                els.popup.nextBtn.textContent = "Next Round";
            }

            els.popup.overlay.classList.remove('hidden');
        }

        els.popup.nextBtn.onclick = () => {
            playSound('click');
            state.currentRound++;
            saveState();
            if (state.currentRound > state.totalRounds) {
                window.location.href = '/results';
            } else {
                loadRound();
            }
        };
    }

    // --- Results ---
    function initResults() {
        const winnerName = document.getElementById('winner-name');
        const winnerScore = document.getElementById('winner-score');
        const scoresList = document.getElementById('final-scores-list');
        const restartBtn = document.getElementById('restart-btn');

        const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
        const winner = sortedPlayers[0];

        winnerName.textContent = `${winner.name} Wins!`;
        winnerScore.textContent = `Score: ${winner.score}`;

        scoresList.innerHTML = '';
        sortedPlayers.forEach(p => {
            const li = document.createElement('li');
            li.className = 'score-item';
            li.innerHTML = `<span>${p.name}</span> <span>${p.score} pts</span>`;
            scoresList.appendChild(li);
        });

        restartBtn.onclick = () => {
            window.location.href = '/';
        };
    }
});
