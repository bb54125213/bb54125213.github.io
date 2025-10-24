// --- DOM要素の取得 ------------------------------------------------
const screens = document.querySelectorAll('.screen');
const startButton = document.getElementById('start-button');

// ゲーム1
const game1Arena = document.getElementById('game-1-arena');
const stimulusObject = document.getElementById('stimulus-object');
const g1TrialCounter = document.getElementById('game-1-trial-counter');
const playAButton = document.getElementById('play-a-button');
const playBButton = document.getElementById('play-b-button');
const slowerButton = document.getElementById('slower-button');
const fasterButton = document.getElementById('faster-button');
const g1SubmitButton = document.getElementById('submit-game-1');

// ゲーム2
const g2TrialCounter = document.getElementById('game-2-trial-counter');
const g2Arena = document.getElementById('game-2-arena');
const avatar = document.getElementById('avatar');
const box = document.getElementById('box');
const statusText = document.getElementById('status-text');
const playComparisonButton = document.getElementById('play-comparison-button');
const choiceButtons = document.getElementById('choice-buttons');
const g2ChoiceEasier = document.getElementById('choice-easier');
const g2ChoiceHarder = document.getElementById('choice-harder');

// ゲーム3 (仮)
const g3TempButton = document.getElementById('goto-results-temp');

// 結果
const resultsOutput = document.getElementById('profile-output');
const restartButton = document.getElementById('restart-button');

// --- 診断結果を保存するオブジェクト ------------------------------
const userProfile = {
    game1_speed: [],
    game2_effort: [],
    game3_comfort: [],
    finalProfile: {}
};

// --- GASへのデータ送信（仮） ------------------------------
const GAS_URL = 'YOUR_GAS_WEB_APP_URL_HERE';
function submitToGAS(profileData) {
    console.log('GASにデータを送信します:', profileData);
    // fetch(GAS_URL, ...) (省略)
    alert('診断が完了しました！(データ送信シミュレーション)');
}

// --- 画面切り替え関数 --------------------------------------------
function showScreen(screenId) {
    screens.forEach(screen => {
        screen.classList.toggle('active', screen.id === screenId);
    });
}

// =================================================================
// --- Web Audio API (音) の準備 ----------------------------------
// =================================================================
let audioContext;
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

/**
 * ビープ音を再生する
 * @param {number} frequency - 周波数 (Hz)
 * @param {number} duration - 持続時間 (秒)
 */
function playBeep(frequency, duration) {
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration - 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}


// =================================================================
// --- ゲーム①：『スピード・チューナー』 (修正版) -------------------
// =================================================================

const BASE_DURATION = 1.5; // 基準(A)の落下時間 (1.5秒)
const ADJUST_STEP = 0.05; // 速度調整のステップ

// 試行リスト (刺激を分離)
const game1Trials = [
    // 色の試行 (6種)
    { id: 'color_red', type: 'color', color: 'red', pattern: 'none', sound: null },
    { id: 'color_green', type: 'color', color: 'green', pattern: 'none', sound: null },
    { id: 'color_blue', type: 'color', color: 'blue', pattern: 'none', sound: null },
    { id: 'color_cyan', type: 'color', color: 'cyan', pattern: 'none', sound: null },
    { id: 'color_magenta', type: 'color', color: 'magenta', pattern: 'none', sound: null },
    { id: 'color_yellow', type: 'color', color: 'yellow', pattern: 'none', sound: null },
    // 模様の試行 (1種)
    { id: 'pattern_stripe', type: 'pattern', color: null, pattern: 'stripe', sound: null },
    // 音の試行 (3種)
    { id: 'sound_low', type: 'sound', color: null, pattern: 'none', sound: 330 }, // 低音
    { id: 'sound_mid', type: 'sound', color: null, pattern: 'none', sound: 660 }, // 中音
    { id: 'sound_high', type: 'sound', color: null, pattern: 'none', sound: 990 }  // 高音
];
let currentGame1TrialIndex = 0;
let currentSpeedRatio = 1.0;

/** 落下アニメーションを実行 */
function playFallAnimation(element, duration, classList) {
    element.style.animation = 'none';
    element.className = 'stimulus'; // 基本クラスにリセット
    void element.offsetWidth; // 再描画

    classList.forEach(cls => element.classList.add(cls));
    element.style.animation = `fall ${duration}s linear forwards`;
    
    setTimeout(() => {
        element.style.animation = 'none';
        element.className = 'stimulus';
    }, duration * 1000);
}

/** ゲーム1の試行をセットアップ */
function setupGame1Trial(trialIndex) {
    if (trialIndex >= game1Trials.length) return;
    g1TrialCounter.textContent = `試行 ${trialIndex + 1} / ${game1Trials.length}`;

    // Bの速度比率をランダム化 (0.7-0.9 または 1.1-1.3)
    let randomRatio = 1.0;
    while(randomRatio > 0.9 && randomRatio < 1.1) {
        randomRatio = (Math.random() > 0.5) ? (0.7 + Math.random() * 0.2) : (1.1 + Math.random() * 0.2);
    }
    currentSpeedRatio = parseFloat(randomRatio.toFixed(2));
    // 速度表示を削除
}

/** ゲーム1のメインロジック */
function runGame1() {
    console.log('ゲーム1実行中...');
    currentGame1TrialIndex = 0;
    setupGame1Trial(currentGame1TrialIndex);
}

// --- ゲーム1 イベントリスナー ---
playAButton.addEventListener('click', () => {
    // 基準A: 無音・グレー・基準速度
    playFallAnimation(stimulusObject, BASE_DURATION, ['stimulus-a-style']);
});

playBButton.addEventListener('click', () => {
    const trial = game1Trials[currentGame1TrialIndex];
    const durationB = BASE_DURATION / currentSpeedRatio;
    let classes = ['stimulus-b-style'];

    if (trial.type === 'sound') {
        // 音の試行: 視覚はグレー、音を再生
        classes.push('stimulus-a-style'); // グレー
        playBeep(trial.sound, durationB);
    } else {
        // 色・模様の試行: 視覚を適用、無音
        if (trial.color) classes.push(`stimulus-b-${trial.color}`);
        if (trial.pattern === 'stripe') classes.push('pattern-stripe');
    }
    
    playFallAnimation(stimulusObject, durationB, classes);
});

slowerButton.addEventListener('click', () => {
    currentSpeedRatio = Math.max(0.5, currentSpeedRatio - ADJUST_STEP);
    // 速度表示を削除
});

fasterButton.addEventListener('click', () => {
    currentSpeedRatio = Math.min(2.0, currentSpeedRatio + ADJUST_STEP);
    // 速度表示を削除
});

g1SubmitButton.addEventListener('click', () => {
    // 1. 結果を記録
    const currentTrial = game1Trials[currentGame1TrialIndex];
    const result = { stimulus: currentTrial.id, ratio: currentSpeedRatio };
    userProfile.game1_speed.push(result);
    console.log('ゲーム1の結果:', result);

    // 2. 次の試行へ
    currentGame1TrialIndex++;
    if (currentGame1TrialIndex < game1Trials.length) {
        setupGame1Trial(currentGame1TrialIndex);
    } else {
        console.log('ゲーム1 全試行終了');
        showScreen('screen-game-2');
        runGame2();
    }
});


// =================================================================
// --- ゲーム②：『エフォート・ジャッジ』 (実装) --------------------
// =================================================================

// ゲーム2の音
const g2Sounds = {
    standard: 440, // A
    low: 330,      // B (低)
    high: 880      // B (高)
};

// ゲーム2の試行リスト (恒常法のため、事前に定義しシャッフル)
let game2Trials = [
    // 色: 3種, 形: 2種, 音: 2種
    { id: 'r_r_l', color: 'red', shape: 'round', sound: g2Sounds.low },
    { id: 'r_s_h', color: 'red', shape: 'sharp', sound: g2Sounds.high },
    { id: 'g_r_h', color: 'green', shape: 'round', sound: g2Sounds.high },
    { id: 'g_s_l', color: 'green', shape: 'sharp', sound: g2Sounds.low },
    { id: 'b_r_l', color: 'blue', shape: 'round', sound: g2Sounds.low },
    { id: 'b_s_h', color: 'blue', shape: 'sharp', sound: g2Sounds.high },
    { id: 'r_s_l', color: 'red', shape: 'sharp', sound: g2Sounds.low },
    { id: 'b_r_h', color: 'blue', shape: 'round', sound: g2Sounds.high }
];
let currentGame2TrialIndex = 0;

/** 努力感アニメーションを再生 */
function playEffortAnimation(type, trial = null) {
    return new Promise(resolve => {
        const duration = 2.0; // アニメーション時間 (2秒)
        
        // アニメーションをリセット
        avatar.style.animation = 'none';
        box.style.animation = 'none';
        avatar.className = 'avatar';
        void avatar.offsetWidth;

        statusText.textContent = `【${type}】`;

        if (type === 'A') {
            // 基準(A): グレー、丸、基準音
            avatar.classList.add('shape-round');
            avatar.style.backgroundColor = '#888';
            playBeep(g2Sounds.standard, duration);
        } else {
            // 比較(B): 試行に基づく
            avatar.classList.add(trial.shape === 'round' ? 'shape-round' : 'shape-sharp');
            avatar.style.backgroundColor = `var(--color-${trial.color})`; // CSS変数から色を取得
            playBeep(trial.sound, duration);
        }

        // アニメーションを適用
        avatar.style.animation = `push ${duration}s linear forwards`;
        box.style.animation = `push ${duration}s linear forwards`;

        setTimeout(() => {
            avatar.style.animation = 'none';
            box.style.animation = 'none';
            statusText.textContent = '';
            resolve();
        }, duration * 1000 + 500); // 終了後0.5秒待つ
    });
}

/** ゲーム2の試行をセットアップ */
function setupGame2Trial(trialIndex) {
    if (trialIndex >= game2Trials.length) return;
    g2TrialCounter.textContent = `試行 ${trialIndex + 1} / ${game2Trials.length}`;

    // 回答ボタンを隠し、再生ボタンを表示
    choiceButtons.style.display = 'none';
    playComparisonButton.style.display = 'block';
    playComparisonButton.disabled = false;
}

/** ゲーム2のメインロジック */
function runGame2() {
    console.log('ゲーム2実行中...');
    // 試行をシャッフル (恒常法)
    game2Trials.sort(() => 0.5 - Math.random());
    currentGame2TrialIndex = 0;
    setupGame2Trial(currentGame2TrialIndex);
}

// --- ゲーム2 イベントリスナー ---
playComparisonButton.addEventListener('click', async () => {
    playComparisonButton.disabled = true;

    // Aを再生
    await playEffortAnimation('A');
    
    // Bを再生
    const trial = game2Trials[currentGame2TrialIndex];
    await playEffortAnimation('B', trial);

    // 再生ボタンを隠し、回答ボタンを表示
    playComparisonButton.style.display = 'none';
    choiceButtons.style.display = 'flex';
});

// 回答ボタン (2種共通のリスナー)
[g2ChoiceEasier, g2ChoiceHarder].forEach(button => {
    button.addEventListener('click', (e) => {
        const choice = e.target.id === 'choice-easier' ? 'easier' : 'harder';
        
        // 1. 結果を記録
        const currentTrial = game2Trials[currentGame2TrialIndex];
        const result = { stimulus: currentTrial.id, choice: choice };
        userProfile.game2_effort.push(result);
        console.log('ゲーム2の結果:', result);

        // 2. 次の試行へ
        currentGame2TrialIndex++;
        if (currentGame2TrialIndex < game2Trials.length) {
            setupGame2Trial(currentGame2TrialIndex);
        } else {
            console.log('ゲーム2 全試行終了');
            showScreen('screen-game-3');
            // runGame3(); // (未実装)
        }
    });
});


// =================================================================
// --- ゲーム③ (仮) ＆ 結果 ----------------------------------------
// =================================================================

// (仮) ゲーム3から結果へ
g3TempButton.addEventListener('click', () => {
    showScreen('screen-results');
    calculateResults();
});

function calculateResults() {
    console.log('結果を計算中...');
    // (ダミーの結果表示)
    const speedRed = userProfile.game1_speed.find(r => r.stimulus === 'color_red');
    const speedResult = speedRed ? `赤色を${speedRed.ratio.toFixed(2)}倍に知覚` : '速度特性 (仮)';
    
    const effortBlue = userProfile.game2_effort.filter(r => r.stimulus.includes('b_'));
    const effortResult = effortBlue.length > 0 ? `青色で${effortBlue[0].choice}に感じた` : '努力特性 (仮)';

    resultsOutput.innerHTML = `
        <h3>あなたのタイプは...</h3>
        <p>【S-Fast / E-Light タイプ (仮)】</p>
        <h3>あなたの感覚特性:</h3>
        <ul>
            <li>速度: ${speedResult}</li>
            <li>努力: ${effortResult}</li>
            <li>快適: （ゲーム③未実装）</li>
        </ul>
    `;
    submitToGAS(userProfile);
}

// --- 画面遷移 ----------------------------------------------------
startButton.addEventListener('click', () => {
    initAudio(); // 最初のユーザー操作でAudioContextを初期化
    showScreen('screen-game-1');
    runGame1();
});

restartButton.addEventListener('click', () => {
    // 診断結果をリセット
    userProfile.game1_speed = [];
    userProfile.game2_effort = [];
    userProfile.game3_comfort = [];
    userProfile.finalProfile = {};
    
    showScreen('screen-intro');
});

// --- 初期化 ----------------------------------------------------
// (CSS変数として色を定義)
document.documentElement.style.setProperty('--color-red', '#FF0000');
document.documentElement.style.setProperty('--color-green', '#00FF00');
document.documentElement.style.setProperty('--color-blue', '#0000FF');

showScreen('screen-intro');