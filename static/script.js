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
    const DB_VERSION = 2; // Upgraded for question pool
    const STORE_NAME = 'questions'; // Per-game storage
    const POOL_STORE_NAME = 'question_pool'; // Persistent pool cache
    let db = null;

    // Configuration for pool cache
    const POOL_CONFIG = {
        MAX_SIZE: 100,           // Max questions per category/difficulty
        MIN_FOR_GAME: 10,        // Minimum needed to skip API
        REFRESH_THRESHOLD: 5,    // Fetch more when below this
        EXPIRY_DAYS: 7           // Pool expires after 7 days
    };

    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject("DB Error");
            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                // Per-game question storage
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
                // Persistent question pool (by category_difficulty key)
                if (!database.objectStoreNames.contains(POOL_STORE_NAME)) {
                    database.createObjectStore(POOL_STORE_NAME, { keyPath: 'key' });
                }
            };
        });
    }

    async function clearGameQuestions() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject("Error clearing game questions");
        });
    }

    async function storeQuestions(questions) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            // Explicitly set id to match round number (1-indexed)
            questions.forEach((q, index) => {
                q.id = index + 1;  // Round 1 = id 1, Round 2 = id 2, etc.
                store.put(q);  // Use put instead of add to handle existing keys
            });
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

    // === QUESTION POOL FUNCTIONS ===

    function getPoolKey(category, difficulty) {
        return `${category}_${difficulty}`;
    }

    async function getPoolData(category, difficulty) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([POOL_STORE_NAME], 'readonly');
            const store = transaction.objectStore(POOL_STORE_NAME);
            const key = getPoolKey(category, difficulty);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject();
        });
    }

    async function savePoolData(category, difficulty, questions) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([POOL_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(POOL_STORE_NAME);
            const key = getPoolKey(category, difficulty);
            const data = {
                key: key,
                questions: questions,
                lastUpdated: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject();
        });
    }

    async function getPoolSize(category, difficulty) {
        const data = await getPoolData(category, difficulty);
        return data ? data.questions.length : 0;
    }

    async function getQuestionsFromPool(category, difficulty, count, excludeIds = []) {
        const data = await getPoolData(category, difficulty);
        if (!data || !data.questions || data.questions.length === 0) {
            return [];
        }

        // Check if pool is expired
        const expiryTime = POOL_CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        if (Date.now() - data.lastUpdated > expiryTime) {
            console.log('[POOL] Cache expired, will refresh');
            return [];
        }

        // Filter out excluded questions
        const excludeSet = new Set(excludeIds);
        let available = data.questions.filter(q => !excludeSet.has(q._id));

        // Shuffle and return requested count
        shuffleArray(available);
        return available.slice(0, count);
    }

    async function addQuestionsToPool(category, difficulty, newQuestions) {
        let data = await getPoolData(category, difficulty);
        let existingQuestions = data ? data.questions : [];

        // Get existing IDs to avoid duplicates
        const existingIds = new Set(existingQuestions.map(q => q._id).filter(id => id));

        // Add only unique new questions
        for (const q of newQuestions) {
            if (q._id && !existingIds.has(q._id)) {
                existingQuestions.push(q);
                existingIds.add(q._id);
            } else if (!q._id) {
                // Generate ID if missing
                q._id = generateQuestionId(q);
                if (!existingIds.has(q._id)) {
                    existingQuestions.push(q);
                    existingIds.add(q._id);
                }
            }
        }

        // Trim to max size (keep newest)
        if (existingQuestions.length > POOL_CONFIG.MAX_SIZE) {
            existingQuestions = existingQuestions.slice(-POOL_CONFIG.MAX_SIZE);
        }

        await savePoolData(category, difficulty, existingQuestions);
        console.log(`[POOL] Saved ${existingQuestions.length} questions for ${category}/${difficulty}`);
    }

    async function poolNeedsRefresh(category, difficulty) {
        const size = await getPoolSize(category, difficulty);
        return size < POOL_CONFIG.REFRESH_THRESHOLD;
    }

    function generateQuestionId(question) {
        const content = question.question + JSON.stringify(question.options);
        // Simple hash function
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit int
        }
        return Math.abs(hash).toString(16).slice(0, 12);
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
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
    // Pre-fetch controller for background question loading
    let prefetchedQuestions = null;
    let prefetchPromise = null;
    let prefetchCategory = null;
    let prefetchDifficulty = null;

    async function prefetchQuestions(category, difficulty) {
        // Only prefetch if category/difficulty changed or no prefetch in progress
        if (prefetchCategory === category && prefetchDifficulty === difficulty && prefetchPromise) {
            return; // Already prefetching for same settings
        }

        prefetchCategory = category;
        prefetchDifficulty = difficulty;
        prefetchedQuestions = null;

        console.log(`[PREFETCH] Starting background fetch for ${category}/${difficulty}`);

        prefetchPromise = fetch('/api/generate_question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                category: category,
                difficulty: difficulty,
                count: 10,
                exclude_ids: getSeenQuestionIds()
            })
        })
            .then(res => res.json())
            .then(data => {
                if (!data.error) {
                    prefetchedQuestions = data;
                    console.log(`[PREFETCH] Successfully pre-loaded ${data.length} questions`);
                }
                return data;
            })
            .catch(err => {
                console.log('[PREFETCH] Background fetch failed:', err);
                return null;
            });
    }

    // Store prefetch data in sessionStorage for loading page
    function savePrefetchedQuestions() {
        if (prefetchedQuestions) {
            sessionStorage.setItem('eot_prefetched', JSON.stringify({
                questions: prefetchedQuestions,
                category: prefetchCategory,
                difficulty: prefetchDifficulty,
                timestamp: Date.now()
            }));
        }
    }

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

        // Start pre-fetching immediately with default settings
        prefetchQuestions(categorySelect.value, difficultySelect.value);

        // Re-prefetch when category or difficulty changes
        categorySelect.addEventListener('change', () => {
            prefetchQuestions(categorySelect.value, difficultySelect.value);
        });
        difficultySelect.addEventListener('change', () => {
            prefetchQuestions(categorySelect.value, difficultySelect.value);
        });

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

            // Save prefetched questions before navigating
            savePrefetchedQuestions();

            saveState();
            window.location.href = '/loading';
        });
    }

    // --- Session Question Tracking (Anti-Repetition) ---
    const SEEN_QUESTIONS_KEY = 'eot_seen_questions';
    const SEEN_QUESTIONS_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in ms

    function getSeenQuestionIds() {
        try {
            const data = localStorage.getItem(SEEN_QUESTIONS_KEY);
            if (!data) return [];

            const parsed = JSON.parse(data);
            // Check if expired
            if (Date.now() - parsed.timestamp > SEEN_QUESTIONS_EXPIRY) {
                localStorage.removeItem(SEEN_QUESTIONS_KEY);
                return [];
            }
            return parsed.ids || [];
        } catch {
            return [];
        }
    }

    function addSeenQuestionIds(questions) {
        const existing = getSeenQuestionIds();
        const newIds = questions.map(q => q._id).filter(id => id);
        const allIds = [...new Set([...existing, ...newIds])];

        // Keep only last 200 to prevent localStorage bloat
        const trimmedIds = allIds.slice(-200);

        localStorage.setItem(SEEN_QUESTIONS_KEY, JSON.stringify({
            ids: trimmedIds,
            timestamp: Date.now()
        }));
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
        await clearGameQuestions(); // Clear per-game storage only (not the pool!)

        try {
            progress.style.width = "20%";
            progress.textContent = "20%";

            let questions = null;
            const requiredCount = 10;
            const seenIds = getSeenQuestionIds();
            const category = state.config.category;
            const difficulty = state.config.difficulty;

            // STEP 1: Try to get questions from IndexedDB pool cache first
            const poolQuestions = await getQuestionsFromPool(category, difficulty, requiredCount, seenIds);

            if (poolQuestions.length >= requiredCount) {
                console.log(`[POOL CACHE HIT] Got ${poolQuestions.length} questions from local cache`);
                questions = poolQuestions;
                status.textContent = "Knowledge Retrieved!";
                progress.style.width = "80%";
                progress.textContent = "80%";
            }

            // STEP 2: Check for pre-fetched questions from setup page (if pool cache missed)
            if (!questions) {
                const prefetched = sessionStorage.getItem('eot_prefetched');
                if (prefetched) {
                    try {
                        const data = JSON.parse(prefetched);
                        if (data.category === category &&
                            data.difficulty === difficulty &&
                            data.questions &&
                            data.questions.length >= requiredCount &&
                            (Date.now() - data.timestamp) < 5 * 60 * 1000) {

                            questions = data.questions;
                            console.log('[PREFETCH HIT] Using pre-fetched questions!');
                            status.textContent = "Knowledge Ready!";
                            progress.style.width = "80%";
                            progress.textContent = "80%";

                            // Store prefetched questions to the pool for future games
                            await addQuestionsToPool(category, difficulty, questions);
                        }
                    } catch (e) {
                        console.log('[LOADING] Prefetch parse error:', e);
                    }
                    sessionStorage.removeItem('eot_prefetched');
                }
            }

            // STEP 3: If still no questions, fetch from API
            if (!questions) {
                console.log('[API FETCH] No cache available, fetching from server...');
                status.textContent = "Fetching from Server...";

                const response = await fetch('/api/generate_question', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        category: category,
                        difficulty: difficulty,
                        count: requiredCount,
                        exclude_ids: seenIds
                    })
                });

                progress.style.width = "60%";
                progress.textContent = "60%";

                questions = await response.json();
                if (questions.error) throw new Error(questions.error);

                // Store API response to pool for future games
                await addQuestionsToPool(category, difficulty, questions);
                console.log(`[API SUCCESS] Fetched and cached ${questions.length} questions`);
            }

            // Track these questions as seen (for anti-repetition)
            addSeenQuestionIds(questions);

            status.textContent = "Storing Knowledge...";
            await storeQuestions(questions);

            progress.style.width = "100%";
            progress.textContent = "100%";

            clearInterval(msgInterval);
            setTimeout(() => {
                window.location.href = '/game';
            }, 300);

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
